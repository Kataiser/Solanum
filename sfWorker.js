class sfWorker {
    constructor() {
        this.engine = loadEngine("/superposition-chess/js/solanum/stockfish-17.1-asm-341ff22.js", function () {});
        this.engine.send("uci");
        this.engine.send("setoption name UCI_Chess960 value true");
        this.engine.send("ucinewgame");
        this.engine.send("isready");
    }

    go() {
        this.engine.send("position fen 1rq2rk1/ppp1nppp/1n1p1b2/8/1PPP4/1N4N1/P1Q2PPP/1R2BK1R w KQ - 1 11");
        this.engine.send("go movetime 10000");
    }
}