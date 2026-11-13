import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { quantityPriceRanges } from "../lib/quantity-pricing.ts";
import type { Product } from "../lib/types.ts";
import { notificationToastModule } from "./helpers/notification-toast.ts";

const require = createRequire(import.meta.url);
type Element = { props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...Object.values(element.props).flatMap(elements)];
}
function load(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const component = () => null;
  vm.runInNewContext(code, { exports, require: (name: string) => name === "@/components/ui/notification-toast" ? notificationToastModule : ((name: string) => dependencies[name] ?? (name === "react/jsx-runtime" ? jsx : name.startsWith("@/") || name === "lucide-react" ? new Proxy({}, { get: () => component }) : require(name)))(name), Date, Set, Map, Intl, Blob, ...globals });
  return exports;
}
function product(sku: string, name: string): Product {
  return { sku, name, material: "PLA", color: "White", colors: ["White"], diameter: "1.75 mm", weight: "1 kg", price: "$5.00", currency: "USD", moq: 1,
    priceTiers: [{ minimumQuantity: 1, price: "$5.00" }], stockStatus: "In stock", leadTime: "3 days", status: "Active", imageUrl: null, updatedAt: null,
    variants: [{ id: sku, sku: `${sku}-WHITE`, name: "White", price: "$5.00", stockStatus: "In stock", imageUrl: null }] };
}
function productsFixture(selected: string[], query = "") {
  let stateIndex = 0;
  let csv: Blob | undefined;
  const errors: string[] = [];
  const exports = load("../components/products-catalog-v2.tsx", {
    react: { useMemo: (fn: () => unknown) => fn(), useState: (initial: unknown) => [stateIndex++ === 2 ? new Set(selected) : typeof initial === "function" ? initial() : initial, () => {}] },
    "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }) },
    "@/components/workspace-memory": { useWorkspaceState: (key: string, initial: unknown) => [key === "products.query" ? query : initial, () => {}] },
    "@/lib/quantity-pricing": { quantityPriceRanges }, "sonner": { toast: { success() {}, error: (message: string) => errors.push(message) } },
  }, { document: { createElement: () => ({ click() {} }) }, URL: { createObjectURL: (value: Blob) => { csv = value; return "blob:test"; }, revokeObjectURL() {} }, navigator: { clipboard: { writeText: async () => { throw new Error("Clipboard blocked"); } } } });
  const tree = exports.ProductsCatalogV2({ products: [product("A", "Alpha"), product("B", "=Formula name")], canWrite: true, mode: "live" });
  return { nodes: elements(tree), csv: () => csv, errors };
}

test("product export follows selected existing products and quotes spreadsheet formulas safely", async () => {
  const fixture = productsFixture(["B", "deleted-sku"], "Alpha");
  const button = fixture.nodes.find(node => node.props.title === "Export selected products")!;
  assert.equal(button.props.disabled, false);
  (button.props.onClick as () => void)();
  const csv = await fixture.csv()!.text();
  assert.match(csv, /"Currency"/);
  assert.match(csv, /"'=Formula name"/);
  assert.doesNotMatch(csv, /"Alpha"/);
  assert.doesNotMatch(csv, /deleted-sku/);
});

test("product selection exposes partial selection and clipboard failures stay actionable", async () => {
  const fixture = productsFixture(["A"]);
  const select = fixture.nodes.find(node => node.props["aria-label"] === "Select visible products")!;
  assert.equal(select.props.checked, false);
  assert.equal(select.props.indeterminate, true);
  const copy = fixture.nodes.find(node => node.props["aria-label"] === "Copy A")!;
  await (copy.props.onClick as (event: { stopPropagation(): void }) => Promise<void>)({ stopPropagation() {} });
  assert.equal(fixture.errors.length, 1);
  assert.match(fixture.errors[0], /Could not copy/);
});

test("an empty product catalog retains its list toolbar and add-product entry point", async () => {
  const exports = load("../app/products/page.tsx", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ role: "admin" }) },
    "@/lib/data/crm": { listProducts: async () => ({ products: [], mode: "live" }) },
    "@/components/products-catalog-v2": { ProductsCatalogV2: "ProductList" },
  });
  const nodes = elements(await exports.default());
  assert.ok(nodes.some(node => Array.isArray(node.props.products) && node.props.products.length === 0 && node.props.canWrite === true));
});

test("quotation creation controls respect viewer read-only access", async () => {
  const exports = load("../app/company-quotations/page.tsx", {
    "@/lib/auth": { requireWorkspaceMember: async () => ({ id: "viewer", role: "viewer" }) },
    "@/lib/data/crm": { listCatalogs: async () => ({ catalogs: [], mode: "live" }), listCompanyOptions: async () => ({ companies: [{ id: "customer", name: "Customer" }] }), listProducts: async () => ({ products: [] }) },
  });
  const controls = elements(await exports.default()).filter(node => node.props.label === "New quotation");
  assert.ok(controls.length > 0);
  assert.ok(controls.every(node => node.props.canWrite === false));
});
