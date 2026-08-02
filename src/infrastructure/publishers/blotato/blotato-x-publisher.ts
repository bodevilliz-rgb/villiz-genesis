import "server-only";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

export class BlotatoXPublisher extends BlotatoPublisherBase {
  readonly platform = "x" as const;
}
