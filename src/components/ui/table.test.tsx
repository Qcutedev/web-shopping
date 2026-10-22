import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableFooter,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  TableStateRow,
} from "./table";

function Sample({ onSort }: { onSort?: () => void }) {
  return (
    <Table caption="รายการคำสั่งซื้อ">
      <TableHeader>
        <TableRow interactive={false}>
          <TableHead>เลขที่</TableHead>
          <TableHead
            align="end"
            sortable
            onSort={onSort}
            sortDirection="ascending"
            sortLabel="เรียงจากน้อยไปมาก"
          >
            ยอดรวม
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell rowHeader>A-001</TableCell>
          <TableCell align="end">฿290.00</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table", () => {
  it("names the table with its caption and exposes a focusable scroll region", () => {
    render(<Sample />);
    const table = screen.getByRole("table", { name: "รายการคำสั่งซื้อ" });
    expect(table.querySelector("caption")?.textContent).toBe("รายการคำสั่งซื้อ");
    const region = screen.getByRole("region", { name: "รายการคำสั่งซื้อ" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.classList.contains("overflow-auto")).toBe(true);
  });

  it("hides the caption visually but keeps it in the accessibility tree", () => {
    render(
      <Table caption="ชื่อ" captionHidden>
        <TableBody />
      </Table>,
    );
    expect(screen.getByRole("table", { name: "ชื่อ" })).toBeTruthy();
    expect(document.querySelector("caption")?.classList.contains("sr-only")).toBe(true);
  });

  it("uses column and row headers", () => {
    render(<Sample />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.getAttribute("scope"))).toEqual(["col", "col"]);
    expect(screen.getByRole("rowheader", { name: "A-001" }).getAttribute("scope")).toBe("row");
  });

  it("right-aligns numeric cells with tabular numerals", () => {
    render(<Sample />);
    const cell = screen.getByRole("cell", { name: "฿290.00" });
    expect(cell.classList.contains("text-right")).toBe(true);
    expect(cell.classList.contains("tabular-nums")).toBe(true);
  });

  it("sets aria-sort on the sortable header and sorts through a button", async () => {
    const onSort = vi.fn();
    render(<Sample onSort={onSort} />);
    const header = screen.getByRole("columnheader", { name: /ยอดรวม/ });
    expect(header.getAttribute("aria-sort")).toBe("ascending");
    const button = within(header).getByRole("button", { name: /ยอดรวม/ });
    expect(button.textContent).toContain("เรียงจากน้อยไปมาก");
    await userEvent.click(button);
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("sorts from the keyboard", async () => {
    const onSort = vi.fn();
    render(<Sample onSort={onSort} />);
    const user = userEvent.setup();
    await user.tab(); // scroll region
    await user.tab(); // sort button
    expect(document.activeElement?.tagName).toBe("BUTTON");
    await user.keyboard("{Enter}");
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("reports an unsorted sortable column as aria-sort none", () => {
    render(
      <Table caption="x">
        <TableHeader>
          <TableRow>
            <TableHead sortable onSort={() => {}}>
              ชื่อ
            </TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(screen.getByRole("columnheader").getAttribute("aria-sort")).toBe("none");
  });

  it("renders no button and no aria-sort when the column is not sortable", () => {
    render(<Sample />);
    const header = screen.getByRole("columnheader", { name: "เลขที่" });
    expect(header.getAttribute("aria-sort")).toBeNull();
    expect(within(header).queryByRole("button")).toBeNull();
  });

  it("marks the wrapper for a sticky header", () => {
    const { container } = render(
      <Table caption="x" stickyHeader>
        <TableBody />
      </Table>,
    );
    expect(container.querySelector("[data-sticky-header]")).toBeTruthy();
  });

  it("uses tighter padding when dense", () => {
    render(
      <Table caption="x" density="dense">
        <TableBody>
          <TableRow>
            <TableCell>ค่า</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("cell").classList.contains("py-2")).toBe(true);
  });

  it("spans the table with a state row", () => {
    render(
      <Table caption="x">
        <TableBody>
          <TableStateRow columns={4}>ไม่มีรายการ</TableStateRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("cell", { name: "ไม่มีรายการ" }).getAttribute("colspan")).toBe("4");
  });

  describe("stacked", () => {
    function Stacked({ stacked = true }: { stacked?: boolean }) {
      return (
        <Table caption="รายการคำสั่งซื้อ" stacked={stacked}>
          <TableHeader>
            <TableRow interactive={false}>
              <TableHead>เลขที่</TableHead>
              <TableHead align="end" sortable onSort={() => {}}>
                ยอดรวม
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell rowHeader>A-001</TableCell>
              <TableCell align="end" label="ยอดรวม">
                ฿290.00
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      );
    }

    it("shows the column label in each cell, visible only below md, hidden from assistive technology", () => {
      render(<Stacked />);
      const cell = screen.getByRole("cell");
      const label = cell.querySelector("span[aria-hidden='true']");
      expect(label?.textContent).toBe("ยอดรวม");
      expect(label?.classList.contains("md:hidden")).toBe(true);
      expect(cell.textContent).toContain("฿290.00");
    });

    it("keeps table roles explicit and the column headers in the tree", () => {
      render(<Stacked />);
      expect(screen.getByRole("table", { name: "รายการคำสั่งซื้อ" })).toBeTruthy();
      expect(screen.getAllByRole("columnheader")).toHaveLength(2);
      expect(screen.getByRole("rowheader", { name: "A-001" })).toBeTruthy();
      expect(screen.getAllByRole("row")).toHaveLength(2);
      expect(document.querySelector("table")?.getAttribute("role")).toBe("table");
      expect(document.querySelector("thead")?.getAttribute("role")).toBe("rowgroup");
      expect(document.querySelector("tbody")?.getAttribute("role")).toBe("rowgroup");
      expect(document.querySelector("tbody tr")?.getAttribute("role")).toBe("row");
      expect(document.querySelector("th[scope='col']")?.getAttribute("role")).toBe("columnheader");
      expect(document.querySelector("th[scope='row']")?.getAttribute("role")).toBe("rowheader");
      expect(document.querySelector("tbody td")?.getAttribute("role")).toBe("cell");
    });

    it("drops the scroll-region keyboard stop below md and keeps it from md", () => {
      const original = window.matchMedia;
      const stub = (matches: boolean) =>
        vi.fn().mockReturnValue({
          matches,
          addEventListener: () => {},
          removeEventListener: () => {},
        });
      try {
        window.matchMedia = stub(true) as unknown as typeof window.matchMedia;
        const below = render(<Stacked />);
        expect(below.container.querySelector("[role='region']")?.hasAttribute("tabindex")).toBe(
          false,
        );
        below.unmount();
        window.matchMedia = stub(false) as unknown as typeof window.matchMedia;
        const wide = render(<Stacked />);
        expect(wide.container.querySelector("[role='region']")?.getAttribute("tabindex")).toBe("0");
        wide.unmount();
        window.matchMedia = stub(true) as unknown as typeof window.matchMedia;
        render(<Stacked stacked={false} />);
        expect(screen.getByRole("region").getAttribute("tabindex")).toBe("0");
      } finally {
        window.matchMedia = original;
      }
    });

    it("uses the md breakpoint query and listens only when stacked", () => {
      const original = window.matchMedia;
      const matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      });
      try {
        window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
        const plain = render(<Stacked stacked={false} />);
        expect(matchMedia).not.toHaveBeenCalled();
        plain.unmount();
        render(<Stacked />);
        expect(matchMedia).toHaveBeenCalledWith("(width < 48rem)");
      } finally {
        window.matchMedia = original;
      }
    });

    it("draws no card inside the footer card", () => {
      render(
        <Table caption="x" stacked>
          <TableFooter>
            <TableRow>
              <TableCell label="รวม">1</TableCell>
            </TableRow>
          </TableFooter>
        </Table>,
      );
      const footer = document.querySelector("tfoot") as HTMLElement;
      expect(footer.className).toContain("max-md:border");
      expect(footer.className).toContain("max-md:[&_tr]:border-0");
      expect(footer.className).toContain("max-md:[&_tr]:bg-transparent");
      expect(footer.className).toContain("max-md:[&_tr]:rounded-none");
    });

    it("turns rows into cards below md and hides the header unless focused", () => {
      render(<Stacked />);
      const body = document.querySelector("tbody") as HTMLElement;
      expect(body.className).toContain("max-md:flex");
      expect(body.querySelector("tr")?.className).toContain("max-md:block");
      expect(document.querySelector("thead")?.className.split(/\s+/)).toContain(
        "max-md:[&:not(:focus-within)]:sr-only",
      );
    });

    it("leaves the table unchanged when stacked is off", () => {
      render(<Stacked stacked={false} />);
      const cell = screen.getByRole("cell");
      expect(cell.querySelector("span[aria-hidden]")).toBeNull();
      expect(cell.className).not.toContain("max-md:");
      expect(document.querySelector("table")?.getAttribute("role")).toBeNull();
      expect(document.querySelector("thead")?.className).not.toContain("max-md:");
    });

    it("keeps the state row cell a plain spanning cell when stacked is off", () => {
      render(
        <Table caption="x">
          <TableBody>
            <TableStateRow columns={3}>ไม่มีรายการ</TableStateRow>
          </TableBody>
        </Table>,
      );
      const cell = screen.getByRole("cell", { name: "ไม่มีรายการ" });
      expect(cell.className).not.toContain("max-md:");
      expect(cell.closest("tr")?.className).not.toContain("max-md:");
    });

    it("makes the state row cell a block below md when stacked", () => {
      render(
        <Table caption="x" stacked>
          <TableBody>
            <TableStateRow columns={3}>ไม่มีรายการ</TableStateRow>
          </TableBody>
        </Table>,
      );
      expect(screen.getByRole("cell", { name: "ไม่มีรายการ" }).className).toContain("max-md:block");
    });
  });

  it("renders hidden skeleton rows", () => {
    render(
      <Table caption="x" aria-busy="true">
        <TableBody>
          <TableSkeletonRows columns={3} rows={2} />
        </TableBody>
      </Table>,
    );
    const rows = document.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(rows[0]?.querySelectorAll("td")).toHaveLength(3);
  });
});
