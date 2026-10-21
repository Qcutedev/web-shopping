import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
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
