const DEBUG = true;
const ENGINE_COUNT = 16;
const SEARCH_TIME = 5000;
const TOTAL_HASH = 512;


// ENGINE STARTUP

let workers = [];
let workersCompleted = 0;
let workersRunning = 0;
let evaluatedPositions = [];

function initEngineWorkers() {
    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i, Math.round(TOTAL_HASH / ENGINE_COUNT));
    }
}


// ENGINE CORE

function engineStartThink() {
    engineDebugLog("thonk");
    workersCompleted = 0;
    evaluatedPositions = [];
    workers.forEach((worker) => worker.reset());

    for (let i = 0; i < auxillaryBoardArray.length; i++) {
        let auxBoard = auxillaryBoardArray[i];
        let startPos = auxBoard.string;
        let startFEN = `${startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${startPos} w KkQq - 0 1`;
        let moves = auxBoard.moves.join(" ");

        // distribute positions across workers
        workers[i % ENGINE_COUNT].addPosition(i + 10000, startFEN, moves);
    }

    workersRunning = Math.min(auxillaryBoardArray.length, ENGINE_COUNT);
    engineDebugLog(`Analyzing ${auxillaryBoardArray.length} auxilliary positions across ${workersRunning} workers`);
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
    let mainBoardMoves = [];
    let mainBoardMovesLen = 0;
    let engineMoveEval = -300;
    let engineMoveRaw = null;
    let engineMoveCoords = null;

    // reverse the perspective: group positions by main board move
    evaluatedPositions.forEach((position) => {
        if (!mainBoardMoves[position.bestMoveRaw]) {
            mainBoardMovesLen++;
            mainBoardMoves[position.bestMoveRaw] = {
                lowestEval: 300,
                moveCoords: position.bestMoveCoords,
                positions: []
            };
        }

        mainBoardMoves[position.bestMoveRaw].positions.push(position);
    });

    engineDebugLog(`Collected ${mainBoardMovesLen} main board moves`);

    // worst-case minimax across superpositions
    for (let mainBoardMove in mainBoardMoves) {
        let mainBoardMoveData = mainBoardMoves[mainBoardMove];

        // step 1: get the lowest eval for each move
        mainBoardMoveData.positions.forEach((position) => {
            if (position.eval < mainBoardMoveData.lowestEval) {
                mainBoardMoveData.lowestEval = position.eval;
            }
        })

        // step 2: select the highest of the lowest evals
        if (mainBoardMoveData.lowestEval > engineMoveEval) {
            engineMoveEval = mainBoardMoveData.lowestEval;
            engineMoveRaw = mainBoardMove;
            engineMoveCoords = mainBoardMoveData.moveCoords;
        }
    }

    if (engineMoveRaw) {
        engineDebugLog(`Playing ${engineMoveRaw} [${engineMoveCoords}], eval ${engineMoveEval}`);
        makeEngineMove(engineMoveCoords);
    }
}

function makeEngineMove(move) {
    let r = move[0];
    let c = move[1];
    heldPiece = mainBoard.pieceArray[r][c];
    heldPiece.r = r; heldPiece.c = c;
    makeMoves(move);
    mainBoard.lastMove = move;
}


// DEBUG

function randomMove() {
    let fullMoves = [];

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            if (mainBoard.pieceArray[r][c] && mainBoard.currentMove === mainBoard.pieceArray[r][c].colour) {
                for (let board of auxillaryBoardArray) {
                    for (let move of board.getLegalMoves(r, c, true, false)) {
                        let fullMove = [r, c, ...move];

                        if (!fullMoves.some(matchFullMove(fullMove)))
                            fullMoves.push(fullMove);
                    }
                }
            }
        }
    }

    return fullMoves[Math.floor(Math.random() * fullMoves.length)];
}

function engineDebugLog(log) {
    if (DEBUG) {
        console.log(log);
    }
}

// MISC

let matchFullMove = a => (b => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);