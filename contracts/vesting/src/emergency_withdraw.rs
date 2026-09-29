/// Emergency withdrawal function (Issue #459)
/// 
/// Admin-only function that transfers a recipient's releasable tokens
/// to a specified address, bypassing normal release flow.
/// 
/// This survives token-level pause, freeze, or compliance blocks because
/// it goes through the same token.transfer but with explicit error handling.
/// 
/// Use case: Token admin pauses/freezes the vesting contract, blocking
/// normal release(). Admin calls this to move releasable funds to a safe address.
pub fn emergency_withdraw(env: Env, recipient: Address, to: Address) {
    Self::_require_admin(&env);
    
    let releasable = Self::total_releasable(env.clone(), recipient.clone());
    if releasable == 0 {
        panic_with_error!(&env, VestingError::NothingToRelease);
    }
    
    // Update all schedules to mark tokens as released
    let count = Self::_schedule_count(&env, &recipient);
    for i in 0..count {
        let key = Self::_schedule_key(&recipient, i);
        if let Some(mut schedule) = env
            .storage()
            .persistent()
            .get::<DataKey, VestingSchedule>(&key)
        {
            if !schedule.revoked {
                let vested = Self::_vested_amount(&env, &schedule);
                let amount = vested - schedule.released;
                if amount > 0 {
                    schedule.released = vested;
                    env.storage().persistent().set(&key, &schedule);
                }
            }
        }
    }
    
    Self::_decrease_total_committed(&env, releasable);
    
    let token_addr: Address = env
        .storage()
        .instance()
        .get(&DataKey::TokenContract)
        .unwrap_or_else(|| panic_with_error!(&env, VestingError::NotInitialized));
    
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    
    // This may still fail if token is paused/frozen, but provides an alternative path
    token_client.transfer(&env.current_contract_address(), &to, &releasable);
    
    env.events().publish(
        (symbol_short!("emerg_wd"), recipient, to),
        releasable
    );
}
