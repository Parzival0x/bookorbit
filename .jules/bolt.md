# Bolt's Journal

## 2023-10-25 - Grouping Vue computed properties in Virtualized Table Cells

**Learning:** In highly virtualized contexts (like `VirtualBookTable`), breaking down derived properties into many individual `computed` variables per cell causes extreme reactivity initialization overhead during rapid scrolling (mount/unmount cycling). A single cell might evaluate 10+ reactive hooks per row, leading to synchronous blocking as row data changes.
**Action:** Consolidate related derived data that depends on the same props into a single `computed` object returning multiple fields per component when inside a virtualized list, slashing the number of reactive watchers per instance.
