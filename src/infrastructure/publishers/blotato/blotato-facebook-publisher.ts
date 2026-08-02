import "server-only";
import { BlotatoPublisherBase } from "./blotato-publisher-base";

export class BlotatoFacebookPublisher extends BlotatoPublisherBase {
  readonly platform = "facebook" as const;
}
