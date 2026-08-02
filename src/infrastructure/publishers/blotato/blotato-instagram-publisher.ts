import "server-only";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

export class BlotatoInstagramPublisher extends BlotatoPublisherBase {
  readonly platform = "instagram" as const;
}
