const DEBUG_LEVEL = 1;  // 0 = no logs, 1 = most logs, 2 = engine go logs
const ENGINE_COUNT = Math.round(window.navigator.hardwareConcurrency * 0.75);
const ENGINE_STRENGTH = 8;  // 1 to 8 from GUI
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
let positionsCache;

function initEngine() {
    console.log("Starting Solanum engine (https://github.com/Kataiser/Solanum)");
    engineDebugLog(`${ENGINE_COUNT} engine workers, ${ENGINE_STRENGTH} strength, ${TOTAL_HASH} total hash`);

    loadPositionsCache('positions_cache_small.json.gz').then(data => {
        positionsCache = data;
        engineDebugLog("Loaded position cache (small)");

        loadPositionsCache('positions_cache_big.json.gz').then(data => {
            for (let [startPos, moves] of Object.entries(data)) {
                for (let [move, eval] of Object.entries(moves)) {
                    positionsCache[startPos][move] = eval;
                }
            }

            engineDebugLog("Loaded position cache (big)");
        });
    });

    for (let i = 0; i < ENGINE_COUNT; i++) {
        workers[i] = new sfWorker(i, DEBUG_LEVEL);
    }
}

async function loadPositionsCache(filename) {
    const response = await fetch(`/superposition-chess/js/solanum/${filename}`);
    const stream = response.body;
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const decompressedResponse = new Response(decompressedStream);
    const text = await decompressedResponse.text();
    return JSON.parse(text);
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

    // add promotions
    for (let newBoard of newBoardArray) {
        engineDebugLog(`Added promotion move ${newBoard.moves[newBoard.moves.length - 1]}`);
        newBoard.opponentPositionID = opponentPositions.length;
        opponentPositions.push(newBoard);
        mainBoardMoves.get(newBoard.lastMove.join("")).push(newBoard);
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
        let moves = opponentPosition.moves.map(s => s.replace(/^[BKNPQR]/, "")).join(" ");

        workers[i % ENGINE_COUNT].addPosition(opponentPosition.opponentPositionID, startPos, moves, opponentPosition.moves.length);
        workers[i % ENGINE_COUNT].setHash(workerHash);
    }

    let targetTime = SEARCH_TIME * (ENGINE_STRENGTH / 8);
    engineDebugLog(`Analyzing ${opponentPositions.length} opponent positions across ${workersRunning} workers (hash ${workerHash}), target = ${targetTime} ms`);
    workers.forEach((worker) => worker.go(targetTime));
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
    let engineMove;
    let engineMoveEval = 1000;
    let engineBestMove;
    let engineBestMoveEval = 1000;
    let actualBestText = "";
    evaluatedPositions = [];
    workers.forEach((worker) => evaluatedPositions = evaluatedPositions.concat(worker.localEvaluatedPositions));

    // for each main board move, find the eval of the best opponent move across superpositions. then, play the move with the worst of those
    // that is, find the worst (lowest) best (highest) opponent move

    // scale from 0 at 8 strength up to +- 8 eval randomly at 1 strength
    let randomScale = (8 - Math.min(ENGINE_STRENGTH, 8)) * 4;

    for (let [mainBoardMove, moveOpponentPositions] of mainBoardMoves) {
        let bestOpponentMoveDecisionEval = -1000;
        let bestOpponentMoveTrueEval = -1000;

        for (let moveOpponentPosition of moveOpponentPositions) {
            let evaluatedPosition = evaluatedPositions.find((pos) => pos.posID === moveOpponentPosition.opponentPositionID);
            let positionDecisionEval = (evaluatedPosition.eval + (0.5 - Math.random()) * randomScale);

            if (positionDecisionEval > bestOpponentMoveDecisionEval) {
                bestOpponentMoveDecisionEval = positionDecisionEval;
            }

            if (evaluatedPosition.eval > bestOpponentMoveTrueEval) {
                bestOpponentMoveTrueEval = evaluatedPosition.eval;
            }
        }

        if (bestOpponentMoveDecisionEval < engineMoveEval) {
            engineMoveEval = bestOpponentMoveDecisionEval;
            engineMove = mainBoardMove;
        }

        if (bestOpponentMoveTrueEval < engineBestMoveEval) {
            engineBestMoveEval = bestOpponentMoveTrueEval;
            engineBestMove = engineMove;
        }
    }

    if (engineMove !== engineBestMove) {
        actualBestText = ` (Actual best move was [${engineMoveToCoords(engineBestMove)}], eval ${(-engineBestMoveEval).toFixed(2)})`;
    }

    let engineMoveCoords = engineMoveToCoords(engineMove);
    engineDebugLog(`Playing [${engineMoveCoords}], eval ${(-engineMoveEval).toFixed(2)}, took ${Date.now() - startTime} ms${actualBestText}`);
    makeEngineMove(engineMoveCoords);
}

function makeEngineMove(move) {
    let r = move[0];
    let c = move[1];
    heldPiece = mainBoard.pieceArray[r][c];
    heldPiece.r = r; heldPiece.c = c;
    makeMoves(move);
}


// MISC


function engineMoveToCoords(move) {
    let moveCoords = [];

    for (let coord of move.split("")) {
        moveCoords.push(parseInt(coord));
    }

    return moveCoords;
}

function engineDebugLog(log) {
    if (DEBUG_LEVEL >= 1) {
        console.log(log);
    }
}
