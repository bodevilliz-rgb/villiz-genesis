import "server-only";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

export class BlotatoLinkedInPublisher extends BlotatoPublisherBase {
  readonly platform = "linkedin" as const;
}
