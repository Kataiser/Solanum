const DEBUG = true;
const ENGINE_COUNT = 14;
const SEARCH_TIME = 8000;
const TOTAL_HASH = 128;
const MAX_THREADS = window.navigator.hardwareConcurrency - 4;
const CONTEMPT = 1;


// ENGINE STARTUP

let workers = [];
let workersCompleted = 0;
let workersRunning = 0;
let evaluatedPositions = [];
let mainBoardMoves = [];

function initEngineWorkers() {
    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i);
    }
}


// ENGINE CORE

function engineStartThink() {
    engineDebugLog("thonk");
    workersCompleted = 0;
    evaluatedPositions = [];
    workers.forEach((worker) => worker.reset());
    workersRunning = Math.min(auxillaryBoardArray.length, ENGINE_COUNT);
    let workerHash = Math.round(TOTAL_HASH / workersRunning);

    for (let i = 0; i < auxillaryBoardArray.length; i++) {
        let auxBoard = auxillaryBoardArray[i];
        let startPos = auxBoard.string;
        let startFEN = `${startPos.toLowerCase()}/pppppppp/8/8/8/8/PPPPPPPP/${startPos} w KkQq - 0 1`;
        let moves = auxBoard.moves.map(s => s.replace(/^[BKNPQR]/, "")).join(" ");

        // distribute positions across workers
        workers[i % ENGINE_COUNT].addPosition(i + 10000, startFEN, moves);
        workers[i % ENGINE_COUNT].setHash(workerHash);
    }

    // set thread count per worker
    if (workersRunning >= MAX_THREADS) {
        workers.forEach((worker) => worker.setThreads(1));
    } else {
        let baseThreads = Math.floor(MAX_THREADS / workersRunning);
        let remainderThreads = MAX_THREADS % workersRunning;

        for (let i = 0; i < workersRunning; i++) {
            if (i < remainderThreads) {
                workers[i].setThreads(baseThreads + 1);
            } else {
                workers[i].setThreads(baseThreads);
            }
        }
    }

    engineDebugLog(`Analyzing ${auxillaryBoardArray.length} auxiliary positions across ${workersRunning} workers (hash ${workerHash})`);
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
    mainBoardMoves = [];
    let mainBoardMovesLen = 0;
    let engineMoveEval = -1000;
    let engineMoveRaw = null;
    let engineMoveCoords = null;

    // reverse the perspective: group positions by main board move
    evaluatedPositions.forEach((position) => {
        if (!mainBoardMoves[position.bestMoveRaw]) {
            mainBoardMovesLen++;
            mainBoardMoves[position.bestMoveRaw] = {
                lowestEval: 1000,
                averageEval: 0,
                weightedEval: 0,
                moveCoords: position.bestMoveCoords,
                positions: []
            };
        }

        mainBoardMoves[position.bestMoveRaw].positions.push(position);
    });

    engineDebugLog(`Collected ${mainBoardMovesLen} main board moves`);
    focusOnMates(mainBoardMovesLen);

    // worst-case minimax across superpositions
    for (let mainBoardMove in mainBoardMoves) {
        let mainBoardMoveData = mainBoardMoves[mainBoardMove];
        let evalSum = 0;

        // step 1: get the lowest eval for each move
        mainBoardMoveData.positions.forEach((position) => {
            evalSum += position.eval;

            if (position.eval < mainBoardMoveData.lowestEval) {
                mainBoardMoveData.lowestEval = position.eval;
            }
        });

        mainBoardMoveData.averageEval = (evalSum / mainBoardMoveData.positions.length).toFixed(3);
        mainBoardMoveData.weightedEval = (mainBoardMoveData.lowestEval +
            ((CONTEMPT * mainBoardMoveData.positions.length) / 1000) +
            ((CONTEMPT * mainBoardMoveData.averageEval) / 10)).toFixed(3);

        // step 2: select the highest of the lowest (weighted) evals
        if (mainBoardMoveData.weightedEval > engineMoveEval) {
            engineMoveEval = mainBoardMoveData.weightedEval;
            engineMoveRaw = mainBoardMove;
            engineMoveCoords = mainBoardMoveData.moveCoords;
        }
    }

    if (engineMoveCoords !== null) {
        engineDebugLog(`Playing ${engineMoveRaw} [${engineMoveCoords}], eval ${engineMoveEval}`);
        // makeEngineMove(engineMoveCoords);
    }
}

// if any worker found any mate, then we know to try to remove moves that don't have only mates
function focusOnMates(mainBoardMovesLen){
    if (mainBoardMovesLen < 2 || !workers.some(worker => worker.foundAnyMate)) {
        return;
    }

    for (let mainBoardMove in mainBoardMoves) {
        let mainBoardMoveData = mainBoardMoves[mainBoardMove];

        if (!mainBoardMoveData.positions.every(position => position.isMate)) {
            delete mainBoardMoves[mainBoardMove];
            mainBoardMovesLen--;
        }
    }

    engineDebugLog(`Trimmed to ${mainBoardMovesLen} main board moves with only checkmates`);
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