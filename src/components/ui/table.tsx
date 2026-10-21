import {
  createContext,
  useContext,
  useId,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "./icons";
import { Skeleton } from "./skeleton";

type TableDensity = "comfortable" | "dense";
type CellAlign = "start" | "end" | "center";
export type SortDirection = "ascending" | "descending";

const DensityContext = createContext<TableDensity>("comfortable");

const ALIGN: Record<CellAlign, string> = {
  start: "text-left",
  end: "text-right tabular-nums",
  center: "text-center",
};

const CELL_PADDING: Record<TableDensity, string> = {
  comfortable: "px-4 py-3",
  dense: "px-3 py-2",
};

export interface TableProps extends Omit<HTMLAttributes<HTMLTableElement>, "children"> {
  /** Names the table for assistive technology and for the scroll region. Always required. */
  caption: ReactNode;
  /** Hides the caption visually; it is still read aloud. Use it when a heading already shows the name. */
  captionHidden?: boolean;
  /** "dense" is for seller and admin dashboards. */
  density?: TableDensity;
  /**
   * Keeps the header row visible while the body scrolls. It sticks inside the table's own scroll
   * area, so also give the table wrapper a height limit, for example `wrapperClassName="max-h-[28rem]"`.
   */
  stickyHeader?: boolean;
  /** Class names of the scroll wrapper. `className` goes to the table element. */
  wrapperClassName?: string;
  /** `thead`, `tbody`, and optionally `tfoot`. */
  children: ReactNode;
}

/**
 * Data table. The wide table scrolls sideways inside its own wrapper, never the page; the wrapper
 * is a labelled, focusable region so a keyboard user can scroll it. Text wraps, so Thai is never
 * cut. Compose it with TableHeader, TableBody, TableRow, TableHead, TableCell.
 */
export function Table({
  caption,
  captionHidden = false,
  density = "comfortable",
  stickyHeader = false,
  wrapperClassName,
  className,
  children,
  ...props
}: TableProps) {
  const captionId = useId();
  return (
    <DensityContext.Provider value={density}>
      {/* A scroll container must be focusable so that the keyboard can scroll it. */}
      <div
        role="region"
        tabIndex={0}
        aria-labelledby={captionId}
        data-sticky-header={stickyHeader || undefined}
        className={cn(
          "group/table border-border bg-surface focus-ring w-full overflow-auto rounded-lg border",
          wrapperClassName,
        )}
      >
        <table
          className={cn("type-small text-foreground w-full border-collapse", className)}
          {...props}
        >
          <caption
            id={captionId}
            className={cn(
              captionHidden ? "sr-only" : "type-label text-foreground px-4 py-3 text-left",
            )}
          >
            {caption}
          </caption>
          {children}
        </table>
      </div>
    </DensityContext.Provider>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-muted", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-border divide-y", className)} {...props} />;
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn("border-border bg-surface-muted type-label border-t", className)}
      {...props}
    />
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Row hover fill. On by default for body rows; pass false for a state row (empty, error). */
  interactive?: boolean;
}

export function TableRow({ interactive = true, className, ...props }: TableRowProps) {
  return (
    <tr
      className={cn(
        interactive && "hover:bg-surface-muted transition-colors duration-150",
        className,
      )}
      {...props}
    />
  );
}

export interface TableHeadProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: CellAlign;
  /**
   * Current sort of this column; leave out when the table is not sorted by it. Present only on a
   * column that can be sorted: pass `sortable` and `onSort`.
   */
  sortDirection?: SortDirection;
  /** Makes the header a button. Needs a Client Component parent for `onSort`. */
  sortable?: boolean;
  onSort?: () => void;
  /** Visually hidden text after the label that says what pressing does, for example "เรียงจากน้อยไปมาก". */
  sortLabel?: string;
}

/** Column header. Sortable headers contain a button; the sort state is `aria-sort` on the `th`. */
export function TableHead({
  align = "start",
  sortable = false,
  sortDirection,
  onSort,
  sortLabel,
  scope = "col",
  className,
  children,
  ...props
}: TableHeadProps) {
  const density = useContext(DensityContext);
  const isSortable = sortable && onSort !== undefined;
  return (
    <th
      scope={scope}
      aria-sort={isSortable ? (sortDirection ?? "none") : undefined}
      className={cn(
        "type-label text-foreground-secondary border-border border-b align-middle font-semibold",
        "bg-surface-muted group-data-[sticky-header]/table:sticky group-data-[sticky-header]/table:top-0 group-data-[sticky-header]/table:z-10",
        CELL_PADDING[density],
        ALIGN[align],
        className,
      )}
      {...props}
    >
      {isSortable ? (
        <button
          type="button"
          onClick={onSort}
          className={cn(
            "focus-ring type-label text-foreground-secondary hover:text-foreground -mx-2 inline-flex min-h-11 items-center gap-1 rounded-sm px-2 font-semibold",
            align === "end" && "flex-row-reverse",
          )}
        >
          <span>{children}</span>
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform duration-150",
              sortDirection === undefined && "opacity-40",
              sortDirection === "ascending" && "rotate-180",
            )}
          />
          {sortLabel ? <span className="sr-only">{sortLabel}</span> : null}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: CellAlign;
  /** Renders a row header (`th scope="row"`) for the cell that names the row. */
  rowHeader?: boolean;
}

export function TableCell({
  align = "start",
  rowHeader = false,
  className,
  children,
  ...props
}: TableCellProps) {
  const density = useContext(DensityContext);
  const classes = cn(
    "text-foreground align-middle break-words",
    CELL_PADDING[density],
    ALIGN[align],
    className,
  );
  if (rowHeader) {
    return (
      <th
        scope="row"
        className={cn(classes, "font-medium")}
        {...(props as ThHTMLAttributes<HTMLTableCellElement>)}
      >
        {children}
      </th>
    );
  }
  return (
    <td className={classes} {...props}>
      {children}
    </td>
  );
}

export interface TableStateRowProps {
  /** Number of columns, so the message spans the table. */
  columns: number;
  /** An EmptyState or ErrorState. */
  children: ReactNode;
}

/** One full-width row for the empty or error presentation of a data table. */
export function TableStateRow({ columns, children }: TableStateRowProps) {
  return (
    <TableRow interactive={false}>
      <td colSpan={columns} className="p-0">
        {children}
      </td>
    </TableRow>
  );
}

export interface TableSkeletonRowsProps {
  columns: number;
  rows?: number;
}

/**
 * Placeholder body rows while data loads. Put them inside TableBody and set `aria-busy="true"` on
 * the Table with a visually hidden loading text, as for other skeletons.
 */
export function TableSkeletonRows({ columns, rows = 5 }: TableSkeletonRowsProps) {
  const rowCount = Math.max(1, Math.trunc(rows));
  const columnCount = Math.max(1, Math.trunc(columns));
  return (
    <>
      {Array.from({ length: rowCount }, (_, row) => (
        <TableRow key={row} interactive={false} aria-hidden="true">
          {Array.from({ length: columnCount }, (_, column) => (
            <TableCell key={column}>
              <Skeleton className="h-4 w-full max-w-40" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
