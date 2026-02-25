class sfWorker {
    constructor(id) {
        this.id = id;
        this.hash = 34;
        this.reset();

        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish-18-asm.js", function () {});
        this.engine.send("uci");
        this.engine.send("setoption name UCI_Chess960 value true");
        this.engine.send(`setoption name Hash value 34`);
        this.engine.send("ucinewgame");
        this.engine.send("isready");
        this.workerDebugLog("Started engine");
    }

    reset() {
        this.positionQueue = [];
        this.currentPositionIndex = 0;
        this.eval = 0;
        this.hashfull = 0;
        this.positionSearchAmount = 0;
        this.localEvaluatedPositions = [];
        this.fromCacheProportion = 0;
        this.expectedSearchFinishTime = 0;
    }

    setHash(hash) {
        if (hash !== this.hash) {
            this.hash = hash;
            this.engine.send(`setoption name Hash value ${hash}`);
        }
    }

    addPosition(posID, startPos, moves, moveCount) {
        this.positionQueue.push({
            posID: posID,
            startPos: startPos,
            moves: moves,
            moveCount: moveCount,
            eval: undefined
        });
    }

    // use the engine to get best move and eval for every queued position
    // note that this can't be a loop because SF completing is a callback
    go(totalSearchTime) {
        if (this.positionQueue.length === 0) {return;}
        let undefinedPositionsCount = this.checkPositionCache();
        this.fromCacheProportion = (this.positionQueue.length - undefinedPositionsCount) / this.positionQueue.length;
        this.workerDebugLog(`Proportion from cache is ${this.fromCacheProportion.toFixed(3)}`, true);

        if (undefinedPositionsCount === 0) {
            this.workerDebugLog("All positions are from cache, skipping regressions");
            this.localEvaluatedPositions = this.positionQueue;
            this.allComplete();
            return;
        }

        // derived via linear regression
        let positionSearchAmountBase = Math.pow(10, (0.480979 + 0.862103 * Math.log10(undefinedPositionsCount) - Math.log10(totalSearchTime)) / -0.883468);

        if (positionSearchAmountBase > 1) {
            // cap in case the regression goes way high
            this.positionSearchAmount = Math.min(Math.round(positionSearchAmountBase), Math.floor(totalSearchTime / undefinedPositionsCount));
            this.useTimeSearch = true;
        } else {
            // we need to spend even less time so use nodes
            this.positionSearchAmount = 20;
            this.useTimeSearch = false;
        }

        this.expectedSearchFinishTime = Date.now() + totalSearchTime;
        let goUnit = this.useTimeSearch ? "ms" : "nodes";
        this.workerDebugLog(`Going for ${this.positionSearchAmount} ${goUnit} each for ${undefinedPositionsCount} positions`);
        this.goEach();
    }

    // "recursively" called from onComplete callbacks
    goEach() {
        let position = this.positionQueue[this.currentPositionIndex];

        // skip cached positions
        while (position.eval !== undefined) {
            this.localEvaluatedPositions.push(position);
            this.currentPositionIndex++;
            position = this.positionQueue[this.currentPositionIndex];

            if (position === undefined) {
                this.allComplete();
                return;
            }
        }

        let positionCommand = `position fen ${position.startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${position.startPos} w KkQq - 0 1 moves ${position.moves}`;
        this.workerDebugLog(`Going from \`${positionCommand}\``, true);
        let goCommand;

        if (this.useTimeSearch) {
            let positionSearchTime = this.positionSearchAmount;

            // fill full search time when possible
            if (this.currentPositionIndex === this.positionQueue.length - 1) {
                let timeRemaining = this.expectedSearchFinishTime - Date.now();

                if (timeRemaining > positionSearchTime) {
                    positionSearchTime = timeRemaining;
                    this.workerDebugLog(`Filling search time from ${this.positionSearchAmount} ms to ${timeRemaining} ms`, true);
                }
            }

            goCommand = `go movetime ${positionSearchTime}`;
        } else {
            goCommand = `go nodes ${this.positionSearchAmount}`;
        }

        this.engine.send(positionCommand);
        this.engine.send(goCommand,
            (result) => {
                this.onComplete(result);
            },
            (line) => {
                this.onLine(line);
            }
        );
    }

    // if a position exists in the precomputed eval cache, use that and remove it from the queue
    checkPositionCache() {
        let positionsCachedCount = 0;

        for (let position of this.positionQueue) {
            if (position.moveCount > 3) {continue;}
            let cachedEval = positionsCache[position.startPos][position.moves];
            if (cachedEval === undefined) {continue;}
            position.eval = cachedEval;
            positionsCachedCount++;
        }

        if (positionsCachedCount > 0) {
            this.workerDebugLog(`${positionsCachedCount}/${this.positionQueue.length} positions are from cache`);
        }

        return this.positionQueue.length - positionsCachedCount;
    }

    // callback from any SF line (after go)
    onLine(line) {
        let matchCp = line.match(/score cp (-?\d+)/);
        let matchMate = line.match(/score mate (\d+)/);
        let matchHashfull = line.match(/hashfull (\d+)/);

        if (matchCp) {
            this.eval = parseInt(matchCp[1]) / 100;
        } else if (matchMate) {
            let movesToMate = parseInt(matchMate[1]);

            if (movesToMate >= 0) {
                this.eval = 200 - Math.log10(movesToMate);
            } else {
                this.eval = -200 + Math.log10(movesToMate);
            }
        }

        if (matchHashfull) {
            this.hashfull = parseInt(matchHashfull[1]) / 10;
        }
    }

    // callback from SF finishing a search
    onComplete(result) {
        let position = this.positionQueue[this.currentPositionIndex];
        let resultLog;

        if (result === "bestmove (none)") {  // checkmate against playing side
            resultLog = "Result: checkmate";
            this.eval = -200;
        } else {
            resultLog = `Result: ${result} (eval ${this.eval}, hashfull ${this.hashfull}%)`;
        }

        this.workerDebugLog(resultLog, true);
        position.eval = this.eval;
        this.localEvaluatedPositions.push(position);
        this.currentPositionIndex++;

        if (this.currentPositionIndex === this.positionQueue.length) {
            this.allComplete();
        } else {
            this.goEach();
        }
    }

    allComplete() {
        this.workerDebugLog(`Completed evaluating ${this.positionQueue.length} positions`);
        workerCompleted();
    }

    workerDebugLog(log, verbose = false) {
        if (!verbose || DEBUG_LEVEL === 2) {
            engineDebugLog(`[Worker ${this.id}] ${log}`);
        }
    }
}
