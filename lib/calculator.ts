export type CalculatorState = {
  display: string;
  stored: number | null;
  operator: string | null;
  fresh: boolean;
};

export const initialCalculator: CalculatorState = { display: "0", stored: null, operator: null, fresh: true };

function calculate(left: number, right: number, operator: string) {
  const value = operator === "+" ? left + right : operator === "−" ? left - right : operator === "×" ? left * right : left / right;
  return Number.isFinite(value) ? String(Number(value.toPrecision(12))) : "Error";
}

export function calculatorInput(state: CalculatorState, key: string): CalculatorState {
  if (key === "AC") return initialCalculator;
  if (/^[0-9.]$/.test(key)) {
    const display = state.fresh || state.display === "Error" ? (key === "." ? "0." : key)
      : key === "." && state.display.includes(".") ? state.display
      : state.display === "0" && key !== "." ? key : state.display.length < 16 ? state.display + key : state.display;
    return { ...state, display, fresh: false };
  }
  if (state.display === "Error") return state;
  if (key === "⌫") return { ...state, display: state.display.slice(0, -1).replace(/^-$/, "") || "0", fresh: false };
  if (key === "±" || key === "%") return { ...state, display: String(key === "%" ? Number(state.display) / 100 : -Number(state.display)) };
  if (["+", "−", "×", "÷", "="].includes(key)) {
    const display = state.operator && state.stored !== null && !state.fresh
      ? calculate(state.stored, Number(state.display), state.operator) : state.display;
    if (display === "Error") return { ...initialCalculator, display };
    return { display, stored: key === "=" ? null : Number(display), operator: key === "=" ? null : key, fresh: true };
  }
  return state;
}
