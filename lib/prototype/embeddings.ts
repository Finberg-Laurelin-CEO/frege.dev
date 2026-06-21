import { createHash } from "node:crypto";

export type EmbeddingProviderName = "none" | "hash";

export type EmbeddingResult = {
  model: string | null;
  vector: number[] | null;
};

export type EmbeddingProvider = {
  name: EmbeddingProviderName;
  model: string | null;
  embedTexts(texts: string[]): Promise<EmbeddingResult[]>;
};

function hashTextToVector(text: string, dimensions = 1536): number[] {
  const vector: number[] = [];
  let counter = 0;

  while (vector.length < dimensions) {
    const digest = createHash("sha256").update(`${counter}:${text}`).digest();
    for (const byte of digest) {
      vector.push(byte / 127.5 - 1);
      if (vector.length === dimensions) break;
    }
    counter += 1;
  }

  return vector;
}

function noneProvider(): EmbeddingProvider {
  return {
    name: "none",
    model: null,
    async embedTexts(texts) {
      return texts.map(() => ({ model: null, vector: null }));
    },
  };
}

function hashProvider(): EmbeddingProvider {
  const model = process.env.FREGE_EMBEDDING_MODEL ?? "frege-hash-embedding-v1";

  return {
    name: "hash",
    model,
    async embedTexts(texts) {
      return texts.map((text) => ({ model, vector: hashTextToVector(text) }));
    },
  };
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = process.env.FREGE_EMBEDDING_PROVIDER ?? "none";

  if (provider === "hash") return hashProvider();
  return noneProvider();
}

export function toPgVector(vector: number[] | null): string | null {
  if (!vector) return null;
  return `[${vector.map((value) => value.toFixed(6)).join(",")}]`;
}
