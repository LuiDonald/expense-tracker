import { Expense } from "../types/expense";
import { currentMonthKey, shiftMonth } from "../lib/format";

// Sample data for demo mode (no Supabase configured). Dates are generated
// relative to the current month so the monthly breakdown always has something
// to show when you're just trying the app out.
const thisMonth = currentMonthKey();
const lastMonth = shiftMonth(thisMonth, -1);

function d(monthKey: string, day: number): string {
  return `${monthKey}-${String(day).padStart(2, "0")}`;
}

export const MOCK_EXPENSES: Expense[] = [
  {
    id: "mock-1",
    merchant: "Costco",
    amount: 182.44,
    category: "Groceries",
    date: d(thisMonth, 3),
    note: "Weekly shop",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-2",
    merchant: "Shell",
    amount: 54.1,
    category: "Gas",
    date: d(thisMonth, 5),
    note: "Full tank",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-3",
    merchant: "Amazon",
    amount: 39.99,
    category: "Shopping",
    date: d(thisMonth, 8),
    note: "Phone case",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-4",
    merchant: "Chipotle",
    amount: 14.75,
    category: "Dining",
    date: d(thisMonth, 9),
    note: "",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-5",
    merchant: "Jiffy Lube",
    amount: 89.0,
    category: "Car",
    date: d(lastMonth, 20),
    note: "Oil change",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-6",
    merchant: "Safeway",
    amount: 63.28,
    category: "Groceries",
    date: d(lastMonth, 14),
    note: "",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "mock-7",
    merchant: "PG&E",
    amount: 120.5,
    category: "Utilities",
    date: d(lastMonth, 2),
    note: "Electric bill",
    photoUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
