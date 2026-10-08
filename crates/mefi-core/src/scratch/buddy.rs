//! A buddy allocator over 4 KiB pages: a complete binary tree in which node
//! k covers 2^order pages and its children are the two halves. The
//! one-dimensional sibling of a quadtree: allocation descends to the smallest
//! block that fits, preferring the lower address, and a freed block merges
//! with its buddy when both halves are free. The tree is a `Vec<u8>` of
//! 2N-1 entries, each the largest free order in that subtree plus one (0 for
//! nothing free), so allocate and free are O(log N). A 512 MiB cap is
//! 131,072 leaves and 256 KiB of tree.

/// Bytes per page, the arena's unit.
pub const PAGE: u64 = 4096;

const USED: u8 = 0;

pub struct Buddy {
    order_max: u8,
    tree: Vec<u8>,
}

/// The order of the smallest block holding `bytes`.
pub fn order_for(bytes: u64) -> u8 {
    let pages = bytes.div_ceil(PAGE).max(1);
    (64 - (pages - 1).leading_zeros()) as u8
}

/// Bytes in a block of `order`.
pub fn block_bytes(order: u8) -> u64 {
    PAGE << order
}

impl Buddy {
    /// A tree of 2^order_max free pages.
    pub fn new(order_max: u8) -> Buddy {
        let nodes = (2usize << order_max) - 1;
        let mut tree = vec![0u8; nodes];
        for depth in 0..=order_max {
            let order = order_max - depth;
            let first = (1usize << depth) - 1;
            for node in tree.iter_mut().skip(first).take(1usize << depth) {
                *node = order + 1;
            }
        }
        Buddy { order_max, tree }
    }

    pub fn order_max(&self) -> u8 {
        self.order_max
    }

    /// Pages the tree covers.
    pub fn pages(&self) -> u64 {
        1u64 << self.order_max
    }

    fn node_of(&self, page: u64, order: u8) -> usize {
        let depth = (self.order_max - order) as usize;
        ((1usize << depth) - 1) + (page >> order) as usize
    }

    fn page_of(&self, node: usize, order: u8) -> u64 {
        let depth = (self.order_max - order) as usize;
        ((node + 1 - (1usize << depth)) as u64) << order
    }

    fn settle(&mut self, mut node: usize) {
        let mut order = self.order_of(node);
        while node > 0 {
            node = (node - 1) / 2;
            order += 1;
            let left = self.tree[2 * node + 1];
            let right = self.tree[2 * node + 2];
            self.tree[node] = if left == order && right == order { order + 1 } else { left.max(right) };
        }
    }

    fn order_of(&self, node: usize) -> u8 {
        let depth = (usize::BITS - (node + 1).leading_zeros() - 1) as u8;
        self.order_max - depth
    }

    /// The first page of a free block of `order`, now used, or None.
    pub fn alloc(&mut self, order: u8) -> Option<u64> {
        if order > self.order_max || self.tree[0] < order + 1 {
            return None;
        }
        let mut node = 0usize;
        let mut here = self.order_max;
        while here > order {
            let left = 2 * node + 1;
            node = if self.tree[left] >= order + 1 { left } else { left + 1 };
            here -= 1;
        }
        self.tree[node] = USED;
        self.settle(node);
        Some(self.page_of(node, order))
    }

    /// Takes the block at `page` of `order`, which must be wholly free.
    pub fn reserve(&mut self, page: u64, order: u8) -> bool {
        if order > self.order_max || page % (1u64 << order) != 0 || page >= self.pages() {
            return false;
        }
        let node = self.node_of(page, order);
        let mut up = node;
        loop {
            if self.tree[up] == USED {
                return false;
            }
            if up == 0 {
                break;
            }
            up = (up - 1) / 2;
        }
        if self.tree[node] != order + 1 {
            return false;
        }
        self.tree[node] = USED;
        self.settle(node);
        true
    }

    /// Marks every page from `from` to the end of the tree as used.
    pub fn reserve_tail(&mut self, from: u64) {
        let mut page = from;
        let end = self.pages();
        while page < end {
            let mut order = 0u8;
            while order < self.order_max && page % (1u64 << (order + 1)) == 0 && page + (1u64 << (order + 1)) <= end {
                order += 1;
            }
            self.reserve(page, order);
            page += 1u64 << order;
        }
    }

    /// Gives the block at `page` of `order` back.
    pub fn free(&mut self, page: u64, order: u8) {
        if order > self.order_max || page >= self.pages() {
            return;
        }
        let node = self.node_of(page, order);
        self.tree[node] = order + 1;
        self.settle(node);
    }

    /// The largest order a request could get now.
    pub fn largest_free(&self) -> Option<u8> {
        (self.tree[0] > 0).then(|| self.tree[0] - 1)
    }

    /// Free pages in the whole tree, counted from the leaves.
    pub fn free_pages(&self) -> u64 {
        let mut count = 0u64;
        let mut stack = vec![0usize];
        while let Some(node) = stack.pop() {
            let order = self.order_of(node);
            if self.tree[node] == USED {
                continue;
            }
            if self.tree[node] == order + 1 {
                count += 1u64 << order;
                continue;
            }
            stack.push(2 * node + 1);
            stack.push(2 * node + 2);
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_follow_sizes() {
        assert_eq!(order_for(0), 0);
        assert_eq!(order_for(1), 0);
        assert_eq!(order_for(4096), 0);
        assert_eq!(order_for(4097), 1);
        assert_eq!(order_for(8192), 1);
        assert_eq!(order_for(8193), 2);
        assert_eq!(order_for(100 * 1024), 5);
        assert_eq!(block_bytes(0), 4096);
        assert_eq!(block_bytes(3), 32768);
    }

    #[test]
    fn allocates_low_first_and_merges_on_free() {
        let mut tree = Buddy::new(3);
        assert_eq!(tree.pages(), 8);
        assert_eq!(tree.alloc(0), Some(0));
        assert_eq!(tree.alloc(0), Some(1));
        assert_eq!(tree.alloc(1), Some(2));
        assert_eq!(tree.alloc(2), Some(4));
        assert_eq!(tree.alloc(0), None);
        assert_eq!(tree.free_pages(), 0);
        tree.free(0, 0);
        assert_eq!(tree.largest_free(), Some(0));
        tree.free(1, 0);
        assert_eq!(tree.largest_free(), Some(1), "two freed leaves merge into their parent");
        tree.free(2, 1);
        assert_eq!(tree.largest_free(), Some(2));
        tree.free(4, 2);
        assert_eq!(tree.largest_free(), Some(3), "everything freed merges back to the root");
        assert_eq!(tree.free_pages(), 8);
        assert_eq!(tree.alloc(3), Some(0));
    }

    #[test]
    fn reserve_takes_exact_blocks() {
        let mut tree = Buddy::new(4);
        assert!(tree.reserve(0, 0), "page 0 is the header");
        assert!(!tree.reserve(0, 0), "already taken");
        assert!(!tree.reserve(0, 1), "a parent of a used block is not free");
        assert!(!tree.reserve(3, 1), "misaligned");
        tree.reserve_tail(11);
        assert_eq!(tree.free_pages(), 10);
        assert_eq!(tree.alloc(0), Some(1));
        assert_eq!(tree.alloc(3), Some(8).filter(|_| false), "no free order-3 block remains");
        assert_eq!(tree.alloc(1), Some(2));
    }

    #[test]
    fn invariant_root_is_the_exact_largest_free_order() {
        // A deterministic churn: the root's answer must always be exact, and
        // the free page count must match what the leaves say.
        let mut tree = Buddy::new(8);
        let mut held: Vec<(u64, u8)> = Vec::new();
        let mut seed = 12345u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) as u64
        };
        for _ in 0..4000 {
            let roll = next() % 3;
            if roll < 2 || held.is_empty() {
                let order = (next() % 5) as u8;
                let before = tree.largest_free();
                match tree.alloc(order) {
                    Some(page) => {
                        assert!(before.is_some_and(|largest| largest >= order));
                        assert_eq!(page % (1u64 << order), 0, "aligned");
                        for (other, other_order) in &held {
                            let a = (page, page + (1u64 << order));
                            let b = (*other, other + (1u64 << other_order));
                            assert!(a.1 <= b.0 || b.1 <= a.0, "blocks never overlap");
                        }
                        held.push((page, order));
                    }
                    None => assert!(before.is_none_or(|largest| largest < order), "a refusal means no block of that order is free"),
                }
            } else {
                let at = (next() as usize) % held.len();
                let (page, order) = held.swap_remove(at);
                tree.free(page, order);
            }
            let used: u64 = held.iter().map(|(_, order)| 1u64 << order).sum();
            assert_eq!(tree.free_pages(), 256 - used);
        }
        for (page, order) in held.drain(..) {
            tree.free(page, order);
        }
        assert_eq!(tree.largest_free(), Some(8));
    }

    #[test]
    fn fragmentation_bound() {
        // Buddy's bound: with every other leaf held, half the pages are free
        // but no block above order 0 exists; freeing the holders restores the
        // root in one pass. Internal waste is at most half of each block.
        let mut tree = Buddy::new(6);
        let pages: Vec<u64> = (0..64).map(|_| tree.alloc(0).expect("a leaf")).collect();
        for page in pages.iter().step_by(2) {
            tree.free(*page, 0);
        }
        assert_eq!(tree.free_pages(), 32);
        assert_eq!(tree.largest_free(), Some(0));
        assert_eq!(tree.alloc(1), None);
        for page in pages.iter().skip(1).step_by(2) {
            tree.free(*page, 0);
        }
        assert_eq!(tree.largest_free(), Some(6));
        for bytes in [1u64, 4096, 4097, 12000, 70000] {
            let order = order_for(bytes);
            assert!(block_bytes(order) >= bytes);
            assert!(order == 0 || block_bytes(order - 1) < bytes, "the smallest block that fits");
        }
    }
}
