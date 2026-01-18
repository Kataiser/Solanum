class sfWorker {
    constructor(id) {
        this.id = id;
        this.reset();

        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish.js/stockfish-17.1-asm-341ff22.js", function () {});
        this.engine.send("uci");
        this.engine.send("setoption name UCI_Chess960 value true");
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
        this.threads = 1;
    }

    setHash(hash) {
        // this.engine.send(`setoption name Hash value ${hash}`);
    }

    setThreads(threads) {
        this.threads = threads;
        // this.engine.send(`setoption name Threads value ${this.threads}`);
    }

    addPosition(posID, startFEN, moves) {
        this.positionQueue.push({
            posID: posID,
            startFEN: startFEN,
            moves: moves,
            eval: null,
            isMate: false
        });
    }

    // use the engine to get best move and eval for every queued position
    // note that this can't be a loop because SF completing is a callback
    go(totalSearchTime) {
        if (this.positionQueue.length !== 0) {
            this.positionSearchTime = Math.floor(totalSearchTime / this.positionQueue.length);
            this.workerDebugLog(`Going for ${this.positionSearchTime} ms each for ${this.positionQueue.length} positions using ${this.threads} threads`);
            this.goEach();
        }
    }

    // "recursively" called from onComplete callbacks
    goEach() {
        let position = this.positionQueue[this.currentPositionIndex];
        let positionCommand = `position fen ${position.startFEN} moves ${position.moves}`;
        // this.workerDebugLog(`Going from \`${positionCommand}\``);

        this.engine.send(positionCommand);
        this.engine.send(`go movetime ${this.positionSearchTime}`,
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
            this.eval = 200 - Math.log(parseInt(matchMate[1]));
            this.positionQueue[this.currentPositionIndex].isMate = true;
        }

        if (matchHashfull) {
            this.hashfull = parseInt(matchHashfull[1]) / 10;
        }
    }

    // callback from SF finishing a search
    onComplete(result) {
        let position = this.positionQueue[this.currentPositionIndex];

        if (result === "bestmove (none)") {  // checkmate against playing side
            this.workerDebugLog("Result: checkmate");
            this.eval = -200;
        } else {
            // this.workerDebugLog(`Result: ${result} (eval ${this.eval}, hashfull ${this.hashfull}%)`);
        }

        position.eval = this.eval;
        evaluatedPositions.push(position);
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

    workerDebugLog(log) {
        engineDebugLog(`[Worker ${this.id}] ${log}`);
    }
}
