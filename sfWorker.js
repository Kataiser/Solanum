class sfWorker {
    constructor(id) {
        this.id = id;
        this.hash = 34;
        this.reset();

        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish.js/src/stockfish-17.1-asm-341ff22.js", function () {});
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
        this.positionSearchTime = 0;
        this.localEvaluatedPositions = [];
    }

    setHash(hash) {
        if (hash !== this.hash) {
            this.hash = hash;
            this.engine.send(`setoption name Hash value ${hash}`);
        }
    }

    addPosition(posID, startFEN, moves) {
        this.positionQueue.push({
            posID: posID,
            startFEN: startFEN,
            moves: moves,
            eval: undefined
        });
    }

    // use the engine to get best move and eval for every queued position
    // note that this can't be a loop because SF completing is a callback
    go(totalSearchTime) {
        if (this.positionQueue.length !== 0) {
            let positionsScaled = Math.log10(this.positionQueue.length);
            let totalSearchTimeScaled = Math.log10(totalSearchTime);
            // derived via linear regression
            let positionSearchAmountBase = Math.pow(10, (0.480979 + 0.862103 * positionsScaled - totalSearchTimeScaled) / -0.883468);

            if (positionSearchAmountBase > 1) {
                this.positionSearchAmount = Math.round(positionSearchAmountBase);
                this.useTimeSearch = true;
            } else {
                // we need more precision so use nodes, less accurate model though
                let positionSearchNodesBase = Math.pow(10, (0.169889 + 0.671984 * positionsScaled - totalSearchTimeScaled) / -0.426464);
                this.positionSearchAmount = Math.max(20, Math.round(positionSearchNodesBase));  // stockfish doesn't let you go below 20 (lol)
                this.useTimeSearch = false;
            }

            let goUnit = this.useTimeSearch ? "ms" : "nodes";
            this.workerDebugLog(`Going for ${this.positionSearchAmount} ${goUnit} each for ${this.positionQueue.length} positions`);
            this.goEach();
        }
    }

    // "recursively" called from onComplete callbacks
    goEach() {
        let position = this.positionQueue[this.currentPositionIndex];
        let positionCommand = `position fen ${position.startFEN} moves ${position.moves}`;
        this.workerDebugLog(`Going from \`${positionCommand}\``, true);
        let goCommand;

        if (this.useTimeSearch) {
            goCommand = `go movetime ${this.positionSearchAmount}`;
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
                this.eval = 200 - Math.log(movesToMate);
            } else {
                this.eval = -200 + Math.log(movesToMate);
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
