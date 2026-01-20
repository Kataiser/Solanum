class sfWorker {
    constructor(id) {
        this.id = id;
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
        this.positionSearchNodes = 0;
        this.hash = 34;
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
            eval: null
        });
    }

    // use the engine to get best move and eval for every queued position
    // note that this can't be a loop because SF completing is a callback
    go() {
        if (this.positionQueue.length !== 0) {
            this.positionSearchNodes = Math.ceil(350 * (1200 / this.positionQueue.length) * (ENGINE_STRENGTH / 8));
            this.workerDebugLog(`Going for ${this.positionSearchNodes} nodes each for ${this.positionQueue.length} positions`);
            this.goEach();
        }
    }

    // "recursively" called from onComplete callbacks
    goEach() {
        let position = this.positionQueue[this.currentPositionIndex];
        let positionCommand = `position fen ${position.startFEN} moves ${position.moves}`;
        this.workerDebugLog(`Going from \`${positionCommand}\``, true);

        this.engine.send(positionCommand);
        this.engine.send(`go nodes ${this.positionSearchNodes}`,
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
