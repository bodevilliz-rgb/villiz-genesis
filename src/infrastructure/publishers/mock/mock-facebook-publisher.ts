import "server-only";
import { MockPublisherBase } from "./mock-publisher-base";

export class MockFacebookPublisher extends MockPublisherBase {
  readonly platform = "facebook" as const;
}
