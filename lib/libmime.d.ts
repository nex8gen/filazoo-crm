declare module "libmime" {
  const mime: {
    decodeWords(value: string): string;
    parseHeaderValue(value: string): { value: string; params: Record<string, string> };
  };
  export default mime;
}
