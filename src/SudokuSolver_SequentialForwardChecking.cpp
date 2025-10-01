#include "SudokuSolver_SequentialForwardChecking.hpp"
#include "helper.hpp"
#include <algorithm>
#include <vector>
#include <set>

SudokuSolver_SequentialForwardChecking::SudokuSolver_SequentialForwardChecking(SudokuBoard& board, bool print_message)
  : SudokuSolver(board)
{
  _mode = MODES::SEQUENTIAL_FORWARDCHECKING;
  if (print_message) {
    std::cout << "\nSequential Sudoku solver using forward checking algorithm starts, please wait...\n";
  }
  board.createStateMatrix(_stateMatrix);
  board.convertToStateMatrix(_stateMatrix);
}

void SudokuSolver_SequentialForwardChecking::propagate(StateMatrix& stateMatrix)
{
  while (true) {
    if (!propagate_step(stateMatrix)) return;
  }
}

bool SudokuSolver_SequentialForwardChecking::propagate_step(StateMatrix& stateMatrix)
{
  bool new_units = false;
  const int BOARD_SIZE = _board.get_board_size();
  const int BOX_SIZE = _board.get_box_size();

  // Row rule
  for (int i = 0; i < BOARD_SIZE; ++i) {
    std::set<int> filled;
    for (auto& e : stateMatrix[i]) if (std::holds_alternative<int>(e)) filled.insert(std::get<int>(e));
    for (int j = 0; j < BOARD_SIZE; ++j) if (std::holds_alternative<std::set<int>>(stateMatrix[i][j])) {
      auto cand = std::get<std::set<int>>(stateMatrix[i][j]);
      std::set<int> tmp;
      std::set_difference(cand.begin(), cand.end(), filled.begin(), filled.end(), std::inserter(tmp, tmp.begin()));
      if (!tmp.empty()) {
        stateMatrix[i][j] = tmp;
        if (tmp.size() == 1) { int v = *tmp.begin(); stateMatrix[i][j] = v; filled.insert(v); new_units = true; }
      }
    }
  }

  // Column rule
  for (int j = 0; j < BOARD_SIZE; ++j) {
    std::set<int> filled;
    for (int i = 0; i < BOARD_SIZE; ++i) if (std::holds_alternative<int>(stateMatrix[i][j])) filled.insert(std::get<int>(stateMatrix[i][j]));
    for (int i = 0; i < BOARD_SIZE; ++i) if (std::holds_alternative<std::set<int>>(stateMatrix[i][j])) {
      auto cand = std::get<std::set<int>>(stateMatrix[i][j]);
      std::set<int> tmp;
      std::set_difference(cand.begin(), cand.end(), filled.begin(), filled.end(), std::inserter(tmp, tmp.begin()));
      stateMatrix[i][j] = tmp;
      if (tmp.size() == 1) { int v = *tmp.begin(); stateMatrix[i][j] = v; filled.insert(v); new_units = true; }
    }
  }

  // Box rule
  for (int bi = 0; bi < BOX_SIZE; ++bi) {
    for (int bj = 0; bj < BOX_SIZE; ++bj) {
      std::set<int> filled;
      for (int s = BOX_SIZE * bi; s < BOX_SIZE * bi + BOX_SIZE; ++s)
        for (int t = BOX_SIZE * bj; t < BOX_SIZE * bj + BOX_SIZE; ++t)
          if (std::holds_alternative<int>(stateMatrix[s][t])) filled.insert(std::get<int>(stateMatrix[s][t]));
      for (int s = BOX_SIZE * bi; s < BOX_SIZE * bi + BOX_SIZE; ++s)
        for (int t = BOX_SIZE * bj; t < BOX_SIZE * bj + BOX_SIZE; ++t) if (std::holds_alternative<std::set<int>>(stateMatrix[s][t])) {
          auto cand = std::get<std::set<int>>(stateMatrix[s][t]);
          std::set<int> tmp;
          std::set_difference(cand.begin(), cand.end(), filled.begin(), filled.end(), std::inserter(tmp, tmp.begin()));
          if (!tmp.empty()) {
            stateMatrix[s][t] = tmp;
            if (tmp.size() == 1) { int v = *tmp.begin(); stateMatrix[s][t] = v; filled.insert(v); new_units = true; }
          }
        }
    }
  }
  return new_units;
}

bool SudokuSolver_SequentialForwardChecking::done(StateMatrix& stateMatrix)
{
    const int N = _board.get_board_size();
    for (int i = 0; i < N; ++i) {
        for (int j = 0; j < N; ++j) {
            if (std::holds_alternative<std::set<int>>(stateMatrix[i][j])) {
                return false;
            }
        }
    }
    return true;
}

SudokuBoard SudokuSolver_SequentialForwardChecking::convertToSudokuGrid(StateMatrix& stateMatrix)
{
	SudokuBoard tmpBoard = SudokuBoard(_board);
    for (int i = 0; i < _board.get_board_size(); ++i)
    {
        for (int j = 0; j < _board.get_board_size(); ++j)
        {
            if (std::holds_alternative<int>(stateMatrix[i][j]))
            {
                tmpBoard.set_board_data(i, j, std::get<int>(stateMatrix[i][j]));
            }
        }
    }

    return tmpBoard;
	for (int i = 0; i < _board.get_board_size(); ++i)
	{
		for (int j = 0; j < _board.get_board_size(); ++j)
		{
			if (std::holds_alternative<int>(stateMatrix[i][j]))
			{
				tmpBoard.set_board_data(i, j, std::get<int>(stateMatrix[i][j]));
			}
		}
	}
	return tmpBoard;
}

void SudokuSolver_SequentialForwardChecking::solve_kernel(StateMatrix& stateMatrix)
{
    if (_solved) return;

	propagate(stateMatrix);

    if (done(stateMatrix))
    {
        _solved = true;
        _solution = convertToSudokuGrid(stateMatrix);
        return;
    }
    else
    { 
        for (int i = 0; i < _board.get_board_size() && !_solved; ++i)
        {
            for (int j = 0; j < _board.get_board_size() && !_solved; ++j)
            {
                if (std::holds_alternative<std::set<int>>(stateMatrix[i][j]))   // if the element stateMatrix[i][j] is of type std::set<int>
                {
                    for (const auto& value : std::get<std::set<int>>(stateMatrix[i][j]))
                    {
                        StateMatrix newStateMatrix = stateMatrix;
                        newStateMatrix[i][j] = value;
                        solve_kernel(newStateMatrix);
                        if (_solved) return;
                    }
                }
            }
        }    
    }
}