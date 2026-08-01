import { CandidateRetrievalService } from "@/server/features/retrieval-service";
import { EventCoordinationService } from "@/server/features/coordination-service";
import { MemoryService } from "@/server/features/memory-service";
import { QuestPipeline } from "@/server/features/quest-pipeline";
import { SafetyGuardianService } from "@/server/features/safety-service";
import { QuestSynthesisService } from "@/server/features/synthesis-service";
import { ConstraintValidator } from "@/server/features/validation-service";
import { InMemoryMemoryRepository } from "@/server/repositories/memory-repository";

const globalServices = globalThis as typeof globalThis & {
  kampungRepository?: InMemoryMemoryRepository;
};

export const memoryRepository =
  globalServices.kampungRepository ?? new InMemoryMemoryRepository();

if (process.env.NODE_ENV !== "production") {
  globalServices.kampungRepository = memoryRepository;
}

export const memoryService = new MemoryService(memoryRepository);
export const retrievalService = new CandidateRetrievalService(memoryRepository);
export const questPipeline = new QuestPipeline(
  memoryRepository,
  retrievalService,
  new QuestSynthesisService(),
  new ConstraintValidator(),
  new SafetyGuardianService(),
  new EventCoordinationService(),
);
