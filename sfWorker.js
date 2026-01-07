class sfWorker {
    constructor(id) {
        this.id = id;
        this.reset();

        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish.js/stockfish-17.1-asm-341ff22.js", function () {});
        this.engine.send("uci");
        this.engine.send("setoption name UCI_Chess960 value true");
        this.engine.send("ucinewgame");
        this.engine.send("isready");
    }

    reset() {
        this.positionQueue = [];
        this.currentPositionIndex = 0;
        this.eval = 0;
        this.positionSearchTime = 0;
        this.completed = false;
    }

    addPosition(posID, startFEN, moves) {
        this.positionQueue.push({
            posID: posID,
            startFEN: startFEN,
            moves: moves,
            bestMoveRaw: null,
            bestMoveCoords: null,
            eval: null
        });
    }

    // use the engine to get best move and eval for every queued position
    // note that this can't be a loop because SF completing is a callback
    go(totalSearchTime) {
        if (this.positionQueue.length !== 0) {
            this.positionSearchTime = Math.floor(totalSearchTime / this.positionQueue.length);
            this.workerDebugLog(`Going for ${this.positionSearchTime} ms each for ${this.positionQueue.length} positions`);
            this.goEach();
        } else {
            this.workerDebugLog("No positions to evaluate");
        }
    }

    // "recursively" called from onComplete callbacks
    goEach() {
        let position = this.positionQueue[this.currentPositionIndex];
        let positionCommand = `position fen ${position.startFEN} moves ${position.moves}`;
        this.workerDebugLog(`Going from \`${positionCommand}\``);

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

    onLine(line) {
        let matchCp = line.match(/score cp (-?\d+)/);
        let matchMate = line.match(/score mate (\d+)/);

        if (matchCp) {
            this.eval = parseInt(matchCp[1]) / 100;
        } else if (matchMate) {
            this.eval = 200;
        }
    }

    // callback from SF finishing a search
    onComplete(result) {
        this.workerDebugLog(`Result: ${result} (eval ${this.eval})`);
        let bestmoveMatch = result.match(/^bestmove ([a-h][1-8][a-h][1-8])([qrbn])?/);  // intentionally ignore promotions
        let position = this.positionQueue[this.currentPositionIndex];
        position.bestMoveRaw = bestmoveMatch[1];
        position.bestMoveCoords = convertMove(bestmoveMatch[1].slice(0, 2), bestmoveMatch[1].slice(2));
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
        this.completed = true;
        workerCompleted();
    }

    workerDebugLog(log) {
        engineDebugLog(`[Worker ${this.id}] ${log}`);
    }
}

// convert from engine format (ex: b1c3) to array position
function convertMove(from, to) {
    let letters = "abcdefgh";
    let sourceC = letters.indexOf(from[0]);
    let sourceR = 8 - parseInt(from[1]);
    let targetC = letters.indexOf(to[0]);
    let targetR = 8 - parseInt(to[1]);
    return [sourceR, sourceC, targetR, targetC];
}