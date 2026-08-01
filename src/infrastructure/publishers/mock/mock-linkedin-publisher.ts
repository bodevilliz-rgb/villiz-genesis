import "server-only";
import { MockPublisherBase } from "./mock-publisher-base";

export class MockLinkedInPublisher extends MockPublisherBase {
  readonly platform = "linkedin" as const;
}
