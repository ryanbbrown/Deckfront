const PIVOT_TOLERANCE: f64 = 1e-9;
pub(crate) const SUPPORT_TOLERANCE: f64 = 1e-6;
pub(crate) const MIX_TOLERANCE: f64 = 1e-6;

struct Simplex {
    rows: usize,
    columns: usize,
    basic: Vec<isize>,
    nonbasic: Vec<isize>,
    tableau: Vec<Vec<f64>>,
}

impl Simplex {
    fn new(a: &[Vec<f64>], b: &[f64], c: &[f64]) -> Result<Self, String> {
        if a.len() != b.len() || a.iter().any(|row| row.len() != c.len()) {
            return Err("linear program dimensions differ".into());
        }
        let rows = b.len();
        let columns = c.len();
        let mut tableau = vec![vec![0.0; columns + 2]; rows + 2];
        let mut basic = vec![0; rows];
        let mut nonbasic = vec![0; columns + 1];
        for row in 0..rows {
            for column in 0..columns {
                tableau[row][column] = a[row][column];
            }
            basic[row] = (columns + row) as isize;
            tableau[row][columns] = -1.0;
            tableau[row][columns + 1] = b[row];
        }
        for column in 0..columns {
            nonbasic[column] = column as isize;
            tableau[rows][column] = -c[column];
        }
        nonbasic[columns] = -1;
        tableau[rows + 1][columns] = 1.0;
        Ok(Self {
            rows,
            columns,
            basic,
            nonbasic,
            tableau,
        })
    }

    fn pivot(&mut self, row: usize, column: usize) {
        let inverse = 1.0 / self.tableau[row][column];
        for held_row in 0..self.rows + 2 {
            if held_row == row {
                continue;
            }
            for held_column in 0..self.columns + 2 {
                if held_column != column {
                    self.tableau[held_row][held_column] -=
                        self.tableau[row][held_column] * self.tableau[held_row][column] * inverse;
                }
            }
        }
        for held_column in 0..self.columns + 2 {
            if held_column != column {
                self.tableau[row][held_column] *= inverse;
            }
        }
        for held_row in 0..self.rows + 2 {
            if held_row != row {
                self.tableau[held_row][column] *= -inverse;
            }
        }
        self.tableau[row][column] = inverse;
        std::mem::swap(&mut self.basic[row], &mut self.nonbasic[column]);
    }

    fn simplex(&mut self, phase: usize) -> bool {
        let objective_row = if phase == 1 { self.rows + 1 } else { self.rows };
        loop {
            let entering = (0..=self.columns)
                .filter(|column| {
                    !(phase == 2 && self.nonbasic[*column] == -1)
                        && self.tableau[objective_row][*column] < -PIVOT_TOLERANCE
                })
                .min_by_key(|column| self.nonbasic[*column]);
            let Some(entering) = entering else {
                return true;
            };
            let mut leaving = None;
            for row in 0..self.rows {
                if self.tableau[row][entering] <= PIVOT_TOLERANCE {
                    continue;
                }
                leaving = match leaving {
                    None => Some(row),
                    Some(current) => {
                        let candidate =
                            self.tableau[row][self.columns + 1] / self.tableau[row][entering];
                        let held = self.tableau[current][self.columns + 1]
                            / self.tableau[current][entering];
                        if candidate < held - PIVOT_TOLERANCE
                            || ((candidate - held).abs() <= PIVOT_TOLERANCE
                                && self.basic[row] < self.basic[current])
                        {
                            Some(row)
                        } else {
                            Some(current)
                        }
                    }
                };
            }
            let Some(leaving) = leaving else {
                return false;
            };
            self.pivot(leaving, entering);
        }
    }

    fn solve(mut self) -> Result<Vec<f64>, String> {
        let mut lowest = 0;
        for row in 1..self.rows {
            if self.tableau[row][self.columns + 1] < self.tableau[lowest][self.columns + 1] {
                lowest = row;
            }
        }
        if self.tableau[lowest][self.columns + 1] < -PIVOT_TOLERANCE {
            self.pivot(lowest, self.columns);
            if !self.simplex(1) || self.tableau[self.rows + 1][self.columns + 1] < -PIVOT_TOLERANCE
            {
                return Err("linear program is infeasible".into());
            }
            if self.tableau[self.rows + 1][self.columns + 1].abs() > PIVOT_TOLERANCE {
                return Err("linear program phase-one residual exceeds 1e-9".into());
            }
            if let Some(row) = self.basic.iter().position(|&variable| variable == -1) {
                let mut entering = 0;
                for column in 1..=self.columns {
                    if self.tableau[row][column].abs()
                        > self.tableau[row][entering].abs() + PIVOT_TOLERANCE
                        || ((self.tableau[row][column].abs() - self.tableau[row][entering].abs())
                            .abs()
                            <= PIVOT_TOLERANCE
                            && self.nonbasic[column] < self.nonbasic[entering])
                    {
                        entering = column;
                    }
                }
                if self.tableau[row][entering].abs() > PIVOT_TOLERANCE {
                    self.pivot(row, entering);
                }
            }
        }
        if !self.simplex(2) {
            return Err("linear program is unbounded".into());
        }
        let mut solution = vec![0.0; self.columns];
        for row in 0..self.rows {
            if self.basic[row] >= 0 && (self.basic[row] as usize) < self.columns {
                solution[self.basic[row] as usize] = self.tableau[row][self.columns + 1];
            }
        }
        Ok(solution)
    }
}

fn witness(payoff: &[Vec<f64>], objective: usize) -> Result<Vec<f64>, String> {
    let size = payoff.len();
    let mut a = Vec::with_capacity(size + 2);
    let mut b = Vec::with_capacity(size + 2);
    a.push(vec![1.0; size]);
    b.push(1.0);
    a.push(vec![-1.0; size]);
    b.push(-1.0);
    a.extend((0..size).map(|column| {
        b.push(0.0);
        (0..size).map(|row| -payoff[row][column]).collect()
    }));
    let mut objective_row = vec![0.0; size];
    objective_row[objective] = 1.0;
    Simplex::new(&a, &b, &objective_row)?.solve()
}

pub(crate) fn solve_maximum_support(payoff: &[Vec<f64>]) -> Result<Vec<f64>, String> {
    let size = payoff.len();
    if size == 0 || payoff.iter().any(|row| row.len() != size) {
        return Err("equilibrium needs a non-empty square matrix".into());
    }
    for (row, values) in payoff.iter().enumerate() {
        for (column, value) in values.iter().enumerate() {
            if !value.is_finite() || (*value + payoff[column][row]).abs() > PIVOT_TOLERANCE {
                return Err("equilibrium payoff matrix must be finite and antisymmetric".into());
            }
        }
    }
    let witnesses = (0..size)
        .map(|objective| witness(payoff, objective))
        .collect::<Result<Vec<_>, _>>()?;
    let supported = witnesses
        .iter()
        .enumerate()
        .filter(|(index, held)| held[*index] > SUPPORT_TOLERANCE)
        .map(|(_, held)| held)
        .collect::<Vec<_>>();
    if supported.is_empty() {
        return Err("maximum-support equilibrium has empty support".into());
    }
    let mut weights = (0..size)
        .map(|index| supported.iter().map(|held| held[index]).sum::<f64>() / supported.len() as f64)
        .map(|weight| weight.max(0.0))
        .collect::<Vec<_>>();
    let total = weights.iter().sum::<f64>();
    if total <= 0.0 {
        return Err("maximum-support equilibrium has zero weight".into());
    }
    for weight in &mut weights {
        *weight /= total;
    }
    verify_mix(payoff, &weights)?;
    Ok(weights)
}

pub(crate) fn verify_mix(payoff: &[Vec<f64>], weights: &[f64]) -> Result<(), String> {
    if payoff.len() != weights.len() || payoff.iter().any(|row| row.len() != weights.len()) {
        return Err("mix dimensions differ from payoff matrix".into());
    }
    if weights
        .iter()
        .any(|weight| !weight.is_finite() || *weight < 0.0)
    {
        return Err("mix has a negative or non-finite weight".into());
    }
    let total = weights.iter().sum::<f64>();
    if (total - 1.0).abs() > PIVOT_TOLERANCE {
        return Err(format!("mix weight sum {total} differs from 1"));
    }
    let advantage = payoff
        .iter()
        .map(|row| {
            row.iter()
                .zip(weights)
                .map(|(value, weight)| value * weight)
                .sum::<f64>()
        })
        .fold(f64::NEG_INFINITY, f64::max);
    if advantage > MIX_TOLERANCE {
        return Err(format!("mix maximum advantage {advantage} exceeds 1e-6"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: &[f64], expected: &[f64]) {
        assert_eq!(actual.len(), expected.len());
        for (held, wanted) in actual.iter().zip(expected) {
            assert!((held - wanted).abs() <= 1e-6, "{actual:?} != {expected:?}");
        }
    }

    #[test]
    fn solves_reference_matrices() {
        for (matrix, expected) in [
            (
                vec![
                    vec![0.0, -1.0, 2.0],
                    vec![1.0, 0.0, -3.0],
                    vec![-2.0, 3.0, 0.0],
                ],
                vec![0.5, 1.0 / 3.0, 1.0 / 6.0],
            ),
            (
                vec![
                    vec![0.0, 0.0, 1.0],
                    vec![0.0, 0.0, 0.0],
                    vec![-1.0, 0.0, 0.0],
                ],
                vec![0.5, 0.5, 0.0],
            ),
            (
                vec![
                    vec![0.0, -1.0, 1.0, 1.0],
                    vec![1.0, 0.0, -1.0, 1.0],
                    vec![-1.0, 1.0, 0.0, 1.0],
                    vec![-1.0, -1.0, -1.0, 0.0],
                ],
                vec![1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0, 0.0],
            ),
            (vec![vec![0.0, 1.0], vec![-1.0, 0.0]], vec![1.0, 0.0]),
        ] {
            let weights = solve_maximum_support(&matrix).expect("solve reference matrix");
            close(&weights, &expected);
            let actual_support = weights
                .iter()
                .map(|weight| *weight > SUPPORT_TOLERANCE)
                .collect::<Vec<_>>();
            let expected_support = expected
                .iter()
                .map(|weight| *weight > SUPPORT_TOLERANCE)
                .collect::<Vec<_>>();
            assert_eq!(actual_support, expected_support);
        }
    }

    fn lcg_matrix(size: usize) -> Vec<Vec<f64>> {
        let mut state = 0x5eed_u32;
        let mut matrix = vec![vec![0.0; size]; size];
        let mut row = 0;
        while row < size {
            let mut column = row + 1;
            while column < size {
                state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let value = f64::from((state % 2001) as i32 - 1000) / 1000.0;
                matrix[row][column] = value;
                matrix[column][row] = -value;
                column += 1;
            }
            row += 1;
        }
        matrix
    }

    #[test]
    fn fifty_strategy_solution_is_valid_and_byte_stable() {
        let weights = solve_maximum_support(&lcg_matrix(50)).expect("solve fixed matrix");
        verify_mix(&lcg_matrix(50), &weights).expect("verify fixed matrix");
        let hex = weights
            .iter()
            .flat_map(|weight| weight.to_le_bytes())
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(
            hex,
            "4d2e81785ec5b43f0000000000000000f38dcca15695a83f000000000000000000000000000000000000000000000000c5437b9e7209b43c00000000000000000000000000000000000000000000000075d46340b487b73f000000000000000000000000000000000000000000000000000000000000000096ce6388ae36913f000000000000000000397ab44779b33f9efd493aa1658c3f52b05106c89bb53f00000000000000000000000000000000000000000000000000000000000000000000000000000000cd38f8e9f66bb03fd90f9a44a462b23f0000000000000000657c5a25faf4b43f0000000000000000000000000000000000000000000000008a0269a5fb7c9d3f000000000000000053074fa4d887643fe19d7cd8373dbe3c000000000000000098b5656c1fddb13f0000000000000000000000000000000000000000000000000000000000000000c57978397f29163d3897c83583c8a43f176b4d33c9827d3f8c84ae4ff779ba3f00000000000000000000000000000000000000000000000081b96f853a1ebe3f"
        );
    }
}
