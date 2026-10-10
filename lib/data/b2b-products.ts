import type { Product } from "@/lib/types";

type QuoteProduct = {
  sku: string;
  name: string;
  material: string;
  colors: string[];
  prices: [number, number, number];
  minimums?: [number, number, number];
  weight?: string;
};

const plaMinimums: [number, number, number] = [1, 100, 500];
const industrialMinimums: [number, number, number] = [1, 20, 200];
const quoteUpdatedAt = "2026-10-08T03:57:07.000Z";

function quotedProduct({ sku, name, material, colors, prices, minimums = plaMinimums, weight = "Not specified" }: QuoteProduct): Product {
  const formattedPrices = prices.map((price) => `$${price.toFixed(2)}`);
  return {
    sku,
    name,
    imageUrl: null,
    material,
    color: colors.length === 1 ? colors[0] : `${colors.length} colors`,
    colors,
    diameter: "Not specified",
    weight,
    price: formattedPrices[0],
    moq: minimums[0],
    priceTiers: minimums.map((minimumQuantity, index) => ({ minimumQuantity, price: formattedPrices[index] })),
    stockStatus: "Quote available",
    leadTime: "Confirm before order",
    status: "Active",
    updatedAt: quoteUpdatedAt,
  };
}

const standardPlaColors = ["White", "Warm White", "Black", "Deep Gray", "Gray", "Forest Green", "Green", "Lemon Green", "Yellow", "Peanut Brown", "Orange", "Red", "Brown", "Wooden", "Skin", "Blue", "Lake Blue", "Sky Blue", "Cyan", "Cyan Green", "Pink", "Sakura Pink", "Purple", "Taro Purple"];
const glossyTpuColors = ["Red", "Green", "Skin", "White", "Yellow", "Silver", "Black", "Transparent"];
const matteTpuColors = ["Black", "White", "Grass Green", "Sky Blue", "Sapphire Blue", "Lemon Yellow", "Parrot Green", "Red", "Skin", "Orange Yellow"];

export const b2bProducts: Product[] = [
  quotedProduct({ sku: "PLA-BASIC", name: "Basic PLA", material: "PLA", colors: standardPlaColors, prices: [5.31, 5.00, 4.79] }),
  quotedProduct({ sku: "PLA-BASIC-MULTI", name: "Basic PLA Multi-color", material: "PLA", colors: ["Colorful Spring", "Summer Coolness", "Colorful Autumn", "Winter's Gentle", "Candy Rainbow", "Macaron"], prices: [5.71, 5.38, 5.15] }),
  quotedProduct({ sku: "PLA-SEMI-TRANSPARENT-GRADIENT", name: "PLA Semi-transparent Gradient", material: "PLA", colors: ["Blue White Orange", "Light Pink", "Blue & Green", "Green & White", "Blue & White"], prices: [5.71, 5.38, 5.15] }),
  quotedProduct({ sku: "PLA-PRO", name: "PLA Pro", material: "PLA", colors: ["White", "Black", "Gray", "Blue", "Green", "Yellow", "Red", "Orange", "Pink", "Skin"], prices: [5.61, 5.29, 5.06] }),
  quotedProduct({ sku: "PLA-MACARON", name: "Macaron PLA", material: "PLA", colors: ["Ice Blue", "Sunny River Blue", "Tender Green", "Milky Green", "Apple Green", "Bright Yellow", "Light Yellow", "Apricot Orange", "Peach Pink", "Coral Pink", "Wisteria Purple", "Light Purple"], prices: [5.43, 5.11, 4.89] }),
  quotedProduct({ sku: "PLA-SILK-BASIC", name: "Silk PLA Basic-color", material: "PLA", colors: ["White", "Black", "Silver", "Bronze", "Red Copper", "Dark Gold", "Bright Gold", "Yellow", "Purple", "Green", "Red", "Rose Red", "Pink", "Blue", "Sky Blue"], prices: [5.71, 5.38, 5.15] }),
  quotedProduct({ sku: "PLA-SILK-TWO-TONE", name: "Silk PLA Two-tone", material: "PLA", colors: ["Red Gold", "Red Blue", "Blue Green", "Yellow Green"], prices: [6.01, 5.66, 5.42] }),
  quotedProduct({ sku: "PLA-SILK-MULTI", name: "Silk PLA Multi-color", material: "PLA", colors: ["Silk Candy", "Silk Macaron", "Iridescent Stars"], prices: [6.01, 5.66, 5.42] }),
  quotedProduct({ sku: "PLA-MATTE-BASIC", name: "Basic Matte PLA", material: "PLA", colors: ["White", "Black", "Gray", "Skin", "Red", "Orange", "Pink", "Yellow", "Blue", "Green", "Purple", "Brown", "Dark Gray"], prices: [5.71, 5.38, 5.15] }),
  quotedProduct({ sku: "PLA-MATTE-MULTI", name: "Matte PLA Multi-color", material: "PLA", colors: ["Spring", "Stellar Dream", "Peach Custard", "Macaron", "Dopamine"], prices: [6.21, 5.85, 5.60] }),
  quotedProduct({ sku: "PLA-GLOW", name: "Glow PLA", material: "PLA", colors: ["Glowing Essence", "Glowing Green"], prices: [6.41, 6.04, 5.78] }),
  quotedProduct({ sku: "PLA-MARBLE", name: "Marble PLA", material: "PLA", colors: ["Marble", "Marble Granite", "Marble Brick Red"], prices: [6.41, 6.04, 5.78] }),
  quotedProduct({ sku: "PLA-WOOD", name: "Wood PLA", material: "PLA", colors: ["White Oak", "Teak Wood", "Cherry Wood", "Walnut Wood"], prices: [8.01, 7.55, 7.22] }),
  quotedProduct({ sku: "PLA-CRYSTAL", name: "Crystal PLA", material: "PLA", colors: ["Pink", "Green", "Purple", "Yellow", "Blue"], prices: [6.41, 6.04, 5.78] }),
  quotedProduct({ sku: "PLA-CRYSTAL-MULTI", name: "Crystal PLA Multi-color", material: "PLA", colors: ["Blue Green", "Red Yellow Blue", "Blue Purple", "Pink Yellow"], prices: [6.81, 6.42, 6.14] }),
  quotedProduct({ sku: "PLA-SILK-HALF-SUGAR", name: "PLA Silk Half Sugar", material: "PLA", colors: ["Spring Tea Green", "Cloud Yellow", "Taro Purple", "Sea Salt Blue", "Hot Pink", "Pomelo Orange", "Peach Milk Pink", "Robin Green"], prices: [6.01, 5.66, 5.42] }),
  quotedProduct({ sku: "PLA-COLOR-CHANGING", name: "PLA Color-Changing Series", material: "PLA", colors: ["Photochromic Magenta", "Photochromic Blue", "Photochromic Red"], prices: [7.83, 7.38, 7.06] }),
  quotedProduct({ sku: "PLA-TEMPERATURE-CHANGE", name: "PLA Temperature Change Series", material: "PLA", colors: ["Thermo Green to Yellow", "Thermo Orange to Yellow", "Thermo Purple to Pink"], prices: [7.83, 7.38, 7.06] }),
  quotedProduct({ sku: "PLA-CF", name: "PLA-CF", material: "PLA-CF", colors: ["Black", "Gray", "Brick Red", "Green", "Blue", "Purple"], prices: [9.96, 9.44, 9.03] }),

  quotedProduct({ sku: "PETG-BASIC", name: "Basic PETG", material: "PETG", colors: [...standardPlaColors, "Emerald Green", "Transparent", "Dark Skin", "Carrot Orange", "Fluorescent Rose Red"], prices: [4.01, 3.78, 3.61] }),
  quotedProduct({ sku: "PETG-RAINBOW", name: "Rainbow PETG", material: "PETG", colors: ["Spring", "Summer", "Autumn", "Winter", "Macaron", "Candy"], prices: [4.64, 4.38, 4.19] }),
  quotedProduct({ sku: "PETG-DOPAMINE", name: "Dopamine PETG", material: "PETG", colors: ["Coral Pink", "Pale Pink", "Peach Pink", "Peach Nude", "Ice Blue", "Sunny Blue", "Pale Indigo", "Pale Green", "Tender Green", "Bright Yellow", "Light Yellow", "Milk Yellow", "Grape Sorbet", "Milky Green", "Mint Dream", "Light Purple", "Pale Purple", "Wisteria Purple"], prices: [4.22, 3.98, 3.81] }),
  quotedProduct({ sku: "PETG-TRANSPARENT-MULTI", name: "Transparent PETG Multi-color", material: "PETG", colors: ["Purple White", "Light Pink", "Blue White", "Blue Green", "Green White", "Blue White Orange", "Dreamy Crystal", "Rainbow Glaze"], prices: [4.64, 4.38, 4.19] }),
  quotedProduct({ sku: "PETG-MATTE", name: "Matte PETG", material: "PETG", colors: ["Black", "Milky White", "Gray", "Deep Gray", "Yellow", "Blue", "Lime Green", "Green", "Brown", "Chocolate Brown", "Coral Pink", "Peach Beige", "Light Tanned Skin", "Fuchsia Purple", "Berry Pink", "Vibrant Orange", "Pastel Turquoise", "Lilac Purple", "Pepper Red", "Coral Red", "Watermelon Red"], prices: [5.01, 4.72, 4.51] }),
  quotedProduct({ sku: "PETG-METAL", name: "Metal PETG", material: "PETG", colors: ["Golden", "Silver", "Coffee Gold"], prices: [4.22, 3.98, 3.81] }),
  quotedProduct({ sku: "PETG-METAL-GALAXY", name: "Metal Galaxy PETG", material: "PETG", colors: ["Galaxy Deep Violet", "Nebula Blue Shade"], prices: [8.19, 7.72, 7.39] }),
  quotedProduct({ sku: "PETG-MARBLE", name: "Marble PETG", material: "PETG", colors: ["Marble"], prices: [4.73, 4.46, 4.27] }),
  quotedProduct({ sku: "PETG-CF", name: "PETG-CF", material: "PETG-CF", colors: ["Black"], prices: [7.01, 6.61, 6.32] }),

  quotedProduct({ sku: "TPU-64D-GLOSSY", name: "TPU-64D Glossy", material: "TPU", colors: glossyTpuColors, prices: [13.00, 12.20, 11.40], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-64D-MATTE", name: "TPU-64D Matte", material: "TPU", colors: matteTpuColors, prices: [13.58, 12.75, 11.91], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-90A-95A-GLOSSY", name: "TPU-90A/95A Glossy", material: "TPU", colors: glossyTpuColors, prices: [9.12, 8.56, 8.00], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-90A-95A-MATTE", name: "TPU-90A/95A Matte", material: "TPU", colors: matteTpuColors, prices: [9.90, 9.29, 8.68], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-85A-GLOSSY", name: "TPU-85A Glossy", material: "TPU", colors: glossyTpuColors, prices: [11.91, 11.46, 10.93], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-85A-MATTE", name: "TPU-85A Matte", material: "TPU", colors: matteTpuColors, prices: [12.31, 11.84, 11.29], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-80A-MATTE", name: "TPU-80A Matte", material: "TPU", colors: matteTpuColors, prices: [13.39, 12.56, 12.15], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-70A-MATTE", name: "TPU-70A Matte", material: "TPU", colors: matteTpuColors, prices: [14.16, 13.29, 12.42], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-70A-FOAM", name: "TPU-70A Foam", material: "TPU", colors: ["White", "Yellow"], prices: [31.04, 29.13, 27.22], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-80A-85A-90A-FOAM", name: "TPU-80A/85A/90A Foam", material: "TPU", colors: ["White", "Yellow"], prices: [30.07, 28.22, 26.37], minimums: industrialMinimums }),
  quotedProduct({ sku: "TPU-95A-GLOW", name: "TPU-95A Glow", material: "TPU", colors: ["Red", "Yellow", "Blue", "Green"], prices: [12.61, 11.84, 11.06], minimums: industrialMinimums }),
  quotedProduct({ sku: "PEBA-35D-40D", name: "PEBA 35D/40D", material: "PEBA", colors: ["Black", "White", "Apple Green", "Gray", "Blue", "Red", "Yellow", "Blue Green", "Bright Yellow"], prices: [23.28, 21.85, 20.42], minimums: industrialMinimums }),

  quotedProduct({ sku: "ABS", name: "ABS", material: "ABS", colors: ["Black", "White", "Yellow", "Green", "Red", "Blue", "Gray"], prices: [7.09, 6.46, 6.20], minimums: industrialMinimums }),
  quotedProduct({ sku: "ABS-CF", name: "ABS-CF", material: "ABS-CF", colors: ["Black"], prices: [11.08, 10.10, 9.69], minimums: industrialMinimums }),
  quotedProduct({ sku: "ABS-GF", name: "ABS-GF", material: "ABS-GF", colors: ["Black"], prices: [10.48, 9.55, 9.16], minimums: industrialMinimums }),
  quotedProduct({ sku: "ABS-ASA", name: "ABS-ASA", material: "ABS-ASA", colors: ["Black", "White", "Yellow", "Green", "Red", "Skin", "Brown", "Pink", "Purple", "Blue", "Orange", "Bright Green", "Silver", "Deep Blue", "Bronze", "Gray", "Light Pink", "Wood", "Gold", "Christmas Green"], prices: [7.05, 6.43, 6.16], minimums: industrialMinimums }),
  quotedProduct({ sku: "PA6-ABS-10", name: "PA6 + 10% ABS", material: "PA6/ABS", colors: ["Black", "White", "Yellow", "Green", "Red", "Skin", "Brown", "Gray", "Purple", "Blue", "Orange"], prices: [8.06, 7.34, 7.04], minimums: industrialMinimums }),
  quotedProduct({ sku: "PC", name: "PC", material: "PC", colors: ["Black", "White", "Yellow", "Green", "Red", "Skin", "Brown", "Purple", "Blue"], prices: [10.07, 9.18, 8.81], minimums: industrialMinimums }),
  quotedProduct({ sku: "PC-CF", name: "PC-CF", material: "PC-CF", colors: ["Black"], prices: [15.11, 13.77, 13.21], minimums: industrialMinimums }),
  quotedProduct({ sku: "PET-CF", name: "PET-CF", material: "PET-CF", colors: ["Black"], prices: [13.10, 11.93, 11.45], minimums: industrialMinimums }),
  quotedProduct({ sku: "ASA", name: "ASA", material: "ASA", colors: ["Black", "White", "Yellow", "Green", "Red", "Pink", "Brown", "Gray", "Purple", "Blue"], prices: [8.46, 7.71, 7.40], minimums: industrialMinimums }),
  quotedProduct({ sku: "ASA-CF", name: "ASA-CF", material: "ASA-CF", colors: ["Black"], prices: [11.08, 10.10, 9.69], minimums: industrialMinimums }),
  quotedProduct({ sku: "PA6-CF", name: "PA6-CF", material: "PA6-CF", colors: ["Black"], prices: [18.13, 16.52, 15.85], minimums: industrialMinimums }),
  quotedProduct({ sku: "PPS", name: "PPS", material: "PPS", colors: ["Black"], prices: [40.30, 36.72, 35.22], minimums: industrialMinimums }),
  quotedProduct({ sku: "PPS-CF", name: "PPS-CF", material: "PPS-CF", colors: ["Black"], prices: [40.30, 36.72, 35.22], minimums: industrialMinimums }),
  quotedProduct({ sku: "PPA", name: "PPA", material: "PPA", colors: ["Black"], prices: [40.30, 36.72, 35.22], minimums: industrialMinimums }),
  quotedProduct({ sku: "PPA-CF", name: "PPA-CF", material: "PPA-CF", colors: ["Black"], prices: [40.30, 36.72, 35.22], minimums: industrialMinimums }),
  quotedProduct({ sku: "PEEK", name: "PEEK", material: "PEEK", colors: ["White"], prices: [302.24, 275.37, 264.18], minimums: industrialMinimums }),
  quotedProduct({ sku: "PEEK-CF-500G", name: "PEEK-CF", material: "PEEK-CF", colors: ["Black"], prices: [211.57, 192.76, 184.93], minimums: industrialMinimums, weight: "0.5 kg" }),
];
