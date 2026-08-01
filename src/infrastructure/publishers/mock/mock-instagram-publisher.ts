import "server-only";
import { MockPublisherBase } from "./mock-publisher-base";

export class MockInstagramPublisher extends MockPublisherBase {
  readonly platform = "instagram" as const;
}
