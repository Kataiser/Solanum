const DEBUG = true;
const ENGINE_COUNT = window.navigator.hardwareConcurrency - 1
const SEARCH_TIME = 1200000;
const TOTAL_HASH = 512;
const MAX_THREADS = window.navigator.hardwareConcurrency - 1;
const CONTEMPT = 0;


// ENGINE STARTUP

let workers = [];
let workersCompleted = 0;
let workersRunning = 0;
let evaluatedPositions = [];
let mainBoardMoves = null;
let opponentPositions = null;

function initEngineWorkers() {
    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i);
    }
}


// ENGINE CORE

function engineStartThink() {
    engineDebugLog("thonk");
    mainBoardMoves = new Map();
    opponentPositions = [];

    // get A. the moves available and B. the opponent's aux boards from each position
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (mainBoard.pieceArray[r][c] && mainBoard.currentMove === mainBoard.pieceArray[r][c].colour) {
                for (let auxBoard of auxillaryBoardArray) {
                    for (let move of auxBoard.getLegalMoves(r, c, true, false)) {
                        let fullMove = [r, c, ...move];
                        let moveKey = fullMove.join("");

                        if (!mainBoardMoves.has(moveKey)) {
                            mainBoardMoves.set(moveKey, []);
                        }

                        let boardAfterMove = cloneBoard(auxBoard);
                        boardAfterMove.string = auxBoard.string;
                        boardAfterMove.makeMove(...fullMove, false);
                        boardAfterMove.opponentPositionID = opponentPositions.length;
                        mainBoardMoves.get(moveKey).push(boardAfterMove);
                        opponentPositions.push(boardAfterMove);
                    }
                }
            }
        }
    }

    engineDebugLog(`Collected ${mainBoardMoves.size} main board moves`);
    workersCompleted = 0;
    evaluatedPositions = [];
    workers.forEach((worker) => worker.reset());
    workersRunning = Math.min(auxillaryBoardArray.length, ENGINE_COUNT);
    let workerHash = Math.round(TOTAL_HASH / workersRunning);

    // distribute positions across workers
    for (let i = 0; i < opponentPositions.length; i++) {
        let opponentPosition = opponentPositions[i];
        let startPos = opponentPosition.string;
        let startFEN = `${startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${startPos} w KkQq - 0 1`;
        let moves = opponentPosition.moves.map(s => s.replace(/^[BKNPQR]/, "")).join(" ");

        workers[i % ENGINE_COUNT].addPosition(opponentPosition.opponentPositionID, startFEN, moves);
        // workers[i % ENGINE_COUNT].setHash(workerHash);
    }

    // set thread count per worker
    // if (workersRunning >= MAX_THREADS) {
    //     workers.forEach((worker) => worker.setThreads(1));
    // } else {
    //     let baseThreads = Math.floor(MAX_THREADS / workersRunning);
    //     let remainderThreads = MAX_THREADS % workersRunning;
    //
    //     for (let i = 0; i < workersRunning; i++) {
    //         if (i < remainderThreads) {
    //             workers[i].setThreads(baseThreads + 1);
    //         } else {
    //             workers[i].setThreads(baseThreads);
    //         }
    //     }
    // }

    engineDebugLog(`Analyzing ${opponentPositions.length} opponent positions across ${workersRunning} workers (hash ${workerHash})`);
    workers.forEach((worker) => worker.go(SEARCH_TIME));
}

// called from a worker each time it finishes
function workerCompleted() {
    workersCompleted++;
    engineDebugLog(`Workers completed: ${workersCompleted}/${workersRunning}`);

    if (workersCompleted === workersRunning) {
        engineFinishThink();
    }
}

// all workers have finished
function engineFinishThink() {
    engineDebugLog("All workers have finished");
    let engineMoveEval = 1000;
    let engineMove;
    let engineMoveCoords = [];

    // for each main board move, find the eval of the best opponent move across superpositions. then, play the move with the worst of those
    // that is, find the worst (lowest) best (highest) opponent move

    for (let [mainBoardMove, opponentPositions] of mainBoardMoves) {
        let bestOpponentMoveEval = -1000;

        for (let opponentPosition of opponentPositions) {
            let evaluatedPosition = evaluatedPositions.find((pos) => pos.posID === opponentPosition.opponentPositionID);

            if (evaluatedPosition.eval > bestOpponentMoveEval) {
                bestOpponentMoveEval = evaluatedPosition.eval;
            }
        }

        if (bestOpponentMoveEval < engineMoveEval) {
            engineMoveEval = bestOpponentMoveEval;
            engineMove = mainBoardMove;
        }
    }

    for (let coord of engineMove.split("")) {
        engineMoveCoords.push(parseInt(coord));
    }

    engineDebugLog(`Playing [${engineMoveCoords}], eval ${-engineMoveEval}`);
    makeEngineMove(engineMoveCoords);
}

function makeEngineMove(move) {
    let r = move[0];
    let c = move[1];
    heldPiece = mainBoard.pieceArray[r][c];
    heldPiece.r = r; heldPiece.c = c;
    makeMoves(move);
    mainBoard.lastMove = move;
}


// MISC

function engineDebugLog(log) {
    if (DEBUG) {
        console.log(log);
    }
}
