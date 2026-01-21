const DEBUG_LEVEL = 1;  // 0 = no logs, 1 = most logs, 2 = engine go logs
const ENGINE_COUNT = Math.round(window.navigator.hardwareConcurrency * 0.75);
const ENGINE_STRENGTH = 8;  // 1 to 8 from GUI, can go higher for engine vs engine
const SEARCH_TIME = 8000;
const TOTAL_HASH = 256;


// ENGINE STARTUP

let workers = [];
let workersCompleted = 0;
let workersRunning = 0;
let evaluatedPositions;
let mainBoardMoves;
let opponentPositions;
let startTime;

function initEngineWorkers() {
    console.log("Starting Solanum engine (https://github.com/Kataiser/Solanum)");
    engineDebugLog(`${ENGINE_COUNT} engine workers, ${ENGINE_STRENGTH} strength, ${TOTAL_HASH} total hash`);

    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i, DEBUG_LEVEL);
    }
}


// ENGINE CORE

function engineStartThink() {
    engineDebugLog("thonk");
    if (auxillaryBoardArray[0].moves.length >= 500) {return;}  // safety
    startTime = Date.now();
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
                        boardAfterMove.moves = structuredClone(auxillaryBoardArray[0].moves);
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
    workers.forEach((worker) => worker.reset());
    workersRunning = Math.min(opponentPositions.length, ENGINE_COUNT);
    let workerHash = Math.round(TOTAL_HASH / workersRunning);

    // distribute positions across workers
    for (let i = 0; i < opponentPositions.length; i++) {
        let opponentPosition = opponentPositions[i];
        let startPos = opponentPosition.string;
        let startFEN = `${startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${startPos} w KkQq - 0 1`;
        let moves = opponentPosition.moves.map(s => s.replace(/^[BKNPQR]/, "")).join(" ");

        workers[i % ENGINE_COUNT].addPosition(opponentPosition.opponentPositionID, startFEN, moves);
        workers[i % ENGINE_COUNT].setHash(workerHash);
    }

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
    evaluatedPositions = [];
    workers.forEach((worker) => evaluatedPositions = evaluatedPositions.concat(worker.localEvaluatedPositions));

    // for each main board move, find the eval of the best opponent move across superpositions. then, play the move with the worst of those
    // that is, find the worst (lowest) best (highest) opponent move

    // scale from 0 at 8 strength up to +- 4 eval randomly at 1 strength
    let randomScale = (8 - Math.min(ENGINE_STRENGTH, 8)) * 2;

    for (let [mainBoardMove, opponentPositions] of mainBoardMoves) {
        let bestOpponentMoveEval = -1000;

        for (let opponentPosition of opponentPositions) {
            let evaluatedPosition = evaluatedPositions.find((pos) => pos.posID === opponentPosition.opponentPositionID);
            let positionEvalComparison = (evaluatedPosition.eval + (0.5 - Math.random()) * randomScale).toFixed(2);

            if (positionEvalComparison > bestOpponentMoveEval) {
                bestOpponentMoveEval = positionEvalComparison;
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

    engineDebugLog(`Playing [${engineMoveCoords}], eval ${-engineMoveEval}, took ${Date.now() - startTime} ms`);
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
    if (DEBUG_LEVEL >= 1) {
        console.log(log);
    }
}
