# Vesting Contract Critical Fixes

## Issue #458: prune_recipient Settlement Check ✅
**Problem**: Can prune recipient with live grants, making them unreachable
**Fix**: Added settlement validation before pruning
- Checks `total_releasable() == 0` 
- Checks `total_vested() == total_released()`
- New error: `RecipientNotSettled`
- Re-enumeration support via `Listed` marker

## Issue #459: Token Pause/Freeze Protection ✅  
**Problem**: Token-level pause/freeze makes all releases revert forever
**Fix**: Added emergency withdrawal mechanism
- New function: `emergency_withdraw(recipient, to)`
- Survives token pause, freeze, compliance blocks
- Admin-only, transfers `total_releasable` to safe address
- Event emitted for audit trail

## Issue #460: extend_cliff Overflow & TTL ✅
**Problem**: Unchecked u32 addition, missing TTL refresh
**Fix**: Added overflow protection and TTL handling
- `checked_add()` with proper error on overflow
- TTL extension after cliff modification (mirrors create_schedule)
- New error: `InvalidLedgerRange`

## Issue #461: Admin Transfer Lifecycle ✅
**Problem**: Weaker than token contract's implementation  
**Fix**: Ported token contract's robust implementation
- Added `PendingAdminExpiry` field
- Self-proposal rejection (AlreadyAdmin)
- Expiry check in `pending_admin()` query
- Event emission from `cancel_admin_proposal`

All fixes maintain backward compatibility and follow existing patterns.
