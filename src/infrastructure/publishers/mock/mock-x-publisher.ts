import "server-only";
import { MockPublisherBase } from "./mock-publisher-base";

export class MockXPublisher extends MockPublisherBase {
  readonly platform = "x" as const;
}
