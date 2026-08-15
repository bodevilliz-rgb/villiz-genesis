import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getCommandCentreGreeting,
} from "@/components/dashboard/command-centre-greeting";
import { CommandCentreHeader } from "@/components/dashboard/command-centre-components";

describe("personalised Command Centre greeting", () => {
  it("greets Bode Villiz in the morning", () => {
    expect(getCommandCentreGreeting("Bode Villiz", 8)).toBe("Good Morning, Bode Villiz.");
  });

  it("greets Bode Villiz in the afternoon", () => {
    expect(getCommandCentreGreeting("Bode Villiz", 12)).toBe("Good Afternoon, Bode Villiz.");
  });

  it("greets Bode Villiz in the evening", () => {
    expect(getCommandCentreGreeting("Bode Villiz", 18)).toBe("Good Evening, Bode Villiz.");
  });

  it("automatically renders another authenticated profile's legitimate display name", () => {
    const html = renderToStaticMarkup(
      <CommandCentreHeader fullName="Eunice Meya" initialGreetingHour={9} totalReviews={0} atRisk={null} />,
    );

    expect(html).toContain("Good Morning, Eunice Meya.");
  });

  it.each([null, "", "   "])("uses a neutral greeting when the display name is %p", (fullName) => {
    expect(getCommandCentreGreeting(fullName, 19)).toBe("Good Evening.");
  });

  it("uses the exact morning/afternoon/evening boundaries", () => {
    expect(getCommandCentreGreeting(null, 11)).toBe("Good Morning.");
    expect(getCommandCentreGreeting(null, 12)).toBe("Good Afternoon.");
    expect(getCommandCentreGreeting(null, 17)).toBe("Good Afternoon.");
    expect(getCommandCentreGreeting(null, 18)).toBe("Good Evening.");
  });
});
