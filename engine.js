function engineThink() {
    console.log("thonk");
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

    let moveSelected = fullMoves[Math.floor(Math.random() * fullMoves.length)];
    let r = moveSelected[0];
    let c = moveSelected[1];
    heldPiece = mainBoard.pieceArray[r][c];
    heldPiece.r = r; heldPiece.c = c;
    makeMoves(moveSelected);
    mainBoard.lastMove = moveSelected;
}

let matchFullMove = a => (b => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
