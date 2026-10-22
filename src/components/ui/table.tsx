import {
  createContext,
  useContext,
  useId,
  useSyncExternalStore,
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
/** True when the table turns into stacked cards below `md`. */
const StackedContext = createContext(false);

const ALIGN: Record<CellAlign, string> = {
  start: "text-left",
  end: "text-right tabular-nums",
  center: "text-center",
};

const CELL_PADDING: Record<TableDensity, string> = {
  comfortable: "px-4 py-3",
  dense: "px-3 py-2",
};

const BELOW_MD_QUERY = "(width < 48rem)";

function subscribeBelowMd(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(BELOW_MD_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function subscribeNever() {
  return () => {};
}

function getFalse() {
  return false;
}

function getBelowMd() {
  return typeof window.matchMedia === "function" && window.matchMedia(BELOW_MD_QUERY).matches;
}

/**
 * True below `md` (only tracked when `enabled`). A stacked table cannot scroll there, so its wrapper drops the keyboard stop
 * (an attribute cannot be responsive in CSS). The server renders the focusable form.
 */
function useBelowMd(enabled: boolean) {
  // Unstacked tables never subscribe, so they add no matchMedia listener.
  return useSyncExternalStore(
    enabled ? subscribeBelowMd : subscribeNever,
    enabled ? getBelowMd : getFalse,
    getFalse,
  );
}

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
  /**
   * Below `md` each body row becomes a card and each cell shows its column name beside its value
   * (give every `TableCell` a `label`). From `md` it is the normal table. Off by default, so
   * existing tables are unchanged. Below `md` the header row is hidden, except that it appears
   * while a sort button has keyboard focus.
   */
  stacked?: boolean;
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
  stacked = false,
  wrapperClassName,
  className,
  children,
  ...props
}: TableProps) {
  const captionId = useId();
  const belowMd = useBelowMd(stacked);
  return (
    <DensityContext.Provider value={density}>
      <StackedContext.Provider value={stacked}>
        {/* A scroll container must be focusable so that the keyboard can scroll it. */}
        <div
          role="region"
          tabIndex={stacked && belowMd ? undefined : 0}
          aria-labelledby={captionId}
          data-sticky-header={stickyHeader || undefined}
          data-stacked={stacked || undefined}
          className={cn(
            "group/table border-border bg-surface focus-ring w-full overflow-auto rounded-lg border",
            stacked && "max-md:overflow-visible max-md:border-0 max-md:bg-transparent",
            wrapperClassName,
          )}
        >
          <table
            // Changing `display` can make browsers drop table semantics, so name the roles when stacked.
            role={stacked ? "table" : undefined}
            className={cn(
              "type-small text-foreground w-full border-collapse",
              stacked && "max-md:block",
              className,
            )}
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
      </StackedContext.Provider>
    </DensityContext.Provider>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  const stacked = useContext(StackedContext);
  return (
    <thead
      role={stacked ? "rowgroup" : undefined}
      className={cn(
        "bg-surface-muted",
        // Each cell carries its own label below md, so the header is hidden there (still read by
        // assistive technology) and shows while a sort button inside it has focus.
        stacked &&
          "max-md:block max-md:[&_th]:border-b-0 max-md:[&_tr]:flex max-md:[&_tr]:flex-wrap max-md:[&:not(:focus-within)]:sr-only",
        className,
      )}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  const stacked = useContext(StackedContext);
  return (
    <tbody
      role={stacked ? "rowgroup" : undefined}
      className={cn(
        "divide-border divide-y",
        stacked && "max-md:flex max-md:flex-col max-md:gap-3 max-md:divide-y-0",
        className,
      )}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  const stacked = useContext(StackedContext);
  return (
    <tfoot
      role={stacked ? "rowgroup" : undefined}
      className={cn(
        "border-border bg-surface-muted type-label border-t",
        // The footer is the card; its rows must not draw a second card inside it.
        stacked &&
          "max-md:mt-3 max-md:block max-md:rounded-lg max-md:border max-md:[&_tr]:rounded-none max-md:[&_tr]:border-0 max-md:[&_tr]:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** Row hover fill. On by default for body rows; pass false for a state row (empty, error). */
  interactive?: boolean;
}

export function TableRow({ interactive = true, className, ...props }: TableRowProps) {
  const stacked = useContext(StackedContext);
  return (
    <tr
      role={stacked ? "row" : undefined}
      className={cn(
        interactive && "hover:bg-surface-muted transition-colors duration-150",
        stacked &&
          "max-md:border-border max-md:bg-surface max-md:block max-md:rounded-lg max-md:border max-md:px-4 max-md:py-2",
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
  const stacked = useContext(StackedContext);
  const isSortable = sortable && onSort !== undefined;
  return (
    <th
      scope={scope}
      role={stacked ? "columnheader" : undefined}
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
  /**
   * Column name for a stacked table; give one to every cell that is not the row header. Shown
   * beside the value below `md` only (from `md` the column header names the cell). It is hidden
   * from assistive technology, which already reads the column header. Ignored unless the Table
   * has `stacked`.
   */
  label?: ReactNode;
}

export function TableCell({
  align = "start",
  rowHeader = false,
  label,
  className,
  children,
  ...props
}: TableCellProps) {
  const density = useContext(DensityContext);
  const stacked = useContext(StackedContext);
  const classes = cn(
    "text-foreground align-middle break-words",
    CELL_PADDING[density],
    ALIGN[align],
    stacked && "max-md:block max-md:px-0",
    className,
  );
  if (rowHeader) {
    return (
      <th
        scope="row"
        role={stacked ? "rowheader" : undefined}
        className={cn(classes, "font-medium", stacked && "max-md:pb-2 max-md:text-left")}
        {...(props as ThHTMLAttributes<HTMLTableCellElement>)}
      >
        {children}
      </th>
    );
  }
  const labelled = stacked && label !== undefined;
  return (
    <td
      role={stacked ? "cell" : undefined}
      className={cn(
        classes,
        labelled && "max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-4",
      )}
      {...props}
    >
      {labelled ? (
        <>
          <span
            aria-hidden="true"
            className="type-label text-foreground-secondary shrink-0 font-semibold md:hidden"
          >
            {label}
          </span>
          <span className="min-w-0 max-md:text-right">{children}</span>
        </>
      ) : (
        children
      )}
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
  const stacked = useContext(StackedContext);
  return (
    <TableRow interactive={false} className={stacked ? "max-md:p-0" : undefined}>
      <td
        colSpan={columns}
        role={stacked ? "cell" : undefined}
        className={cn("p-0", stacked && "max-md:block")}
      >
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
