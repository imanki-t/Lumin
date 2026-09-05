import { aiRouter } from '@/core/ai/router.js';
import { memoryRepo } from '@/core/database/repositories/index.js';
import { VectorDocumentChunk } from '@/core/database/schema.js';
import { MEMORY_CONFIG } from '@/config/constants.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DocumentRAG');

export class DocumentRAGService {
  private static instance: DocumentRAGService;

  private constructor() {}

  public static get(): DocumentRAGService {
    if (!DocumentRAGService.instance) {
      DocumentRAGService.instance = new DocumentRAGService();
    }
    return DocumentRAGService.instance;
  }

  /**
   * Cosine similarity calculation between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      const a = vecA[i]!;
      const b = vecB[i]!;
      dot += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Indexes an uploaded document into vector chunks using gemini-embedding-2
   */
  public async indexDocument(
    contextId: string,
    fileName: string,
    rawText: string,
    metadata: { fileType: string; uploadedBy: string }
  ): Promise<number> {
    const chunks = this.chunkText(rawText, 1000, 200);
    const vectorChunks: VectorDocumentChunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]!;
      const embedding = await aiRouter.generateEmbedding(content);
      vectorChunks.push({
        id: `chunk_${contextId}_${Date.now()}_${i}`,
        contextId,
        fileName,
        chunkIndex: i,
        content,
        embedding,
        metadata: {
          fileType: metadata.fileType,
          uploadedBy: metadata.uploadedBy,
          timestamp: new Date()
        }
      });
    }

    await memoryRepo.storeVectorChunks(vectorChunks);
    logger.info(`Indexed document "${fileName}" into ${vectorChunks.length} vector chunks for ${contextId}`);
    return vectorChunks.length;
  }

  /**
   * Executes vector similarity search on document chunks (invoked ONLY for explicit document queries)
   */
  public async searchDocuments(contextId: string, query: string): Promise<string[]> {
    const queryVec = await aiRouter.generateEmbedding(query);
    if (queryVec.length === 0) return [];

    const chunks = await memoryRepo.getVectorChunksByContext(contextId);
    if (chunks.length === 0) return [];

    const scored = chunks
      .map((chunk) => ({
        chunk,
        score: this.cosineSimilarity(queryVec, chunk.embedding)
      }))
      .filter((item) => item.score >= MEMORY_CONFIG.RAG_SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MEMORY_CONFIG.MAX_RAG_CHUNKS);

    return scored.map((s) => `[File: ${s.chunk.fileName}] ${s.chunk.content}`);
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start += chunkSize - overlap;
    }
    return chunks;
  }
}

export const documentRAG = DocumentRAGService.get();
