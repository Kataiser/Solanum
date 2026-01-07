class sfWorker {
    constructor(id) {
        this.id = id;

        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish.js/stockfish-17.1-asm-341ff22.js", function () {});
        this.engine.send("uci");
        this.engine.send("setoption name UCI_Chess960 value true");
        this.engine.send("ucinewgame");
        this.engine.send("isready");

        this.positionQueue = [];
        this.eval = 0;
    }

    go(startFEN, moves) {
        this.engine.send(`position fen ${startFEN} moves ${moves}`);
        this.engine.send("go movetime 1000",
            (result) => {this.onComplete(result);},
            (line) => {this.onLine(line);}
        );
    }

    onLine(line) {
        this.workerDebugLog(line);

        let matchCp = line.match(/score cp (-?\d+)/);
        let matchMate = line.match(/score mate (\d+)/);

        if (matchCp) {
            this.eval = parseInt(matchCp[1]) / 100;
        } else if (matchMate) {
            this.eval = 200;
        }
    }

    onComplete(result) {
        this.workerDebugLog(`Result: ${result} (eval ${this.eval})`);

        let match = result.match(/^bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
        // intentionally ignore promotion
        makeEngineMove(convertMove(match[1], match[2]));
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