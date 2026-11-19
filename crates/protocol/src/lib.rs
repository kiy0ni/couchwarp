//! Wire formats shared by the Couchwarp host, the room server and the browser client.
//!
//! The TypeScript twin lives in `packages/protocol`. Both are tested against the
//! examples in `fixtures/protocol`, which are the reference.

pub mod control;
pub mod input;
pub mod room;
pub mod signal;
