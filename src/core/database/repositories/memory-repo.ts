import { database } from '@/core/database/connection.js';
import { DialogueSummaryEntity, VectorDocumentChunk } from '@/core/database/schema.js';

export class MemoryRepository {
  private memorySummaries = new Map<string, DialogueSummaryEntity>();
  private memoryChunks = new Map<string, VectorDocumentChunk[]>();

  public async getSummary(contextId: string): Promise<DialogueSummaryEntity | null> {
    const db = database.getDb();
    if (db) {
      return await db.collection<DialogueSummaryEntity>('dialogue_summaries').findOne({ contextId });
    }
    return this.memorySummaries.get(contextId) || null;
  }

  public async saveSummary(summary: DialogueSummaryEntity): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<DialogueSummaryEntity>('dialogue_summaries').updateOne(
        { contextId: summary.contextId },
        { $set: summary },
        { upsert: true }
      );
    }
    this.memorySummaries.set(summary.contextId, summary);
  }

  public async storeVectorChunks(chunks: VectorDocumentChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const db = database.getDb();
    if (db) {
      await db.collection<VectorDocumentChunk>('vector_chunks').insertMany(chunks);
    }

    const contextId = chunks[0]!.contextId;
    const current = this.memoryChunks.get(contextId) || [];
    this.memoryChunks.set(contextId, [...current, ...chunks]);
  }

  public async getVectorChunksByContext(contextId: string): Promise<VectorDocumentChunk[]> {
    const db = database.getDb();
    if (db) {
      return await db.collection<VectorDocumentChunk>('vector_chunks').find({ contextId }).toArray();
    }
    return this.memoryChunks.get(contextId) || [];
  }

  public async deleteVectorChunksByContext(contextId: string): Promise<void> {
    const db = database.getDb();
    if (db) {
      await db.collection<VectorDocumentChunk>('vector_chunks').deleteMany({ contextId });
    }
    this.memoryChunks.delete(contextId);
  }
}

export const memoryRepo = new MemoryRepository();
