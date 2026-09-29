import { collectContractEventPages } from "../useContractEvents";

describe("collectContractEventPages", () => {
  it("collects a saturated 100-event page and the following page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `event-${index + 1}`,
      pagingToken: `cursor-${index + 1}`,
      ledger: 500,
    }));
    const lastEvent = {
      id: "event-101",
      pagingToken: "cursor-101",
      ledger: 501,
    };
    const getEvents = jest
      .fn()
      .mockResolvedValueOnce({ events: firstPage })
      .mockResolvedValueOnce({ events: [lastEvent] });

    const result = await collectContractEventPages(
      getEvents,
      {},
      500,
      [{ type: "contract", contractIds: ["CTOKEN"] }],
    );

    expect(result.events).toHaveLength(101);
    expect(result.events.at(-1)).toEqual(lastEvent);
    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(getEvents.mock.calls[1][0]).toMatchObject({
      startLedger: 500,
      pagination: { limit: 100, cursor: "cursor-100" },
    });
    expect(result.nextCursor).toBeUndefined();
  });
});
