// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.4;
contract Purchase {
    uint public value;
    address payable public seller;
    address payable public buyer;

    enum State { Created, Locked, Release, Inactive }
    // 状态变量的默认值为第一个成员，`State.created`
    State public state;

    modifier condition(bool condition_) {
        require(condition_);
        _;
    }

    /// 只有买方可以调用此函数。
    error OnlyBuyer();
    /// 只有卖方可以调用此函数。
    error OnlySeller();
    /// 当前状态下无法调用该函数。
    error InvalidState();
    /// 提供的值必须是偶数。
    error ValueNotEven();

    modifier onlyBuyer() {
        if (msg.sender != buyer)
            revert OnlyBuyer();
        _;
    }

    modifier onlySeller() {
        if (msg.sender != seller)
            revert OnlySeller();
        _;
    }

    modifier inState(State state_) {
        if (state != state_)
            revert InvalidState();
        _;
    }

    event Aborted();
    event PurchaseConfirmed();
    event ItemReceived();
    event SellerRefunded();

    // 确保 `msg.value` 是一个偶数。
    // 如果是奇数，除法将截断。
    // 通过乘法检查它不是奇数。
    constructor() payable {
        seller = payable(msg.sender);
        value = msg.value / 2;
        if ((2 * value) != msg.value)
            revert ValueNotEven();
    }

    /// 中止购买并收回以太币。
    /// 只能由卖方在合约被锁定之前调用。
    function abort()
        external
        onlySeller
        inState(State.Created)
    {
        emit Aborted();
        state = State.Inactive;
        // 我们在这里直接使用转账。
        // 可用于防止重入，因为它是此函数中的最后一个调用，我们已经改变了状态。
        seller.transfer(address(this).balance);
    }

    /// 作为买方确认购买。
    /// 交易必须包括 `2 * value` 以太币。
    /// 以太币将在调用 confirmReceived 之前被锁定。
    function confirmPurchase()
        external
        inState(State.Created)
        condition(msg.value == (2 * value))
        payable
    {
        emit PurchaseConfirmed();
        buyer = payable(msg.sender);
        state = State.Locked;
    }

    /// 确认你（买方）收到了物品。
    /// 这将释放锁定的以太币。
    function confirmReceived()
        external
        onlyBuyer
        inState(State.Locked)
    {
        emit ItemReceived();
        // 首先改变状态是很重要的，
        // 否则，使用 `send` 调用的合约可以再次调用这里。
        state = State.Release;

        buyer.transfer(value);
    }

    /// 此函数退款给卖方，即退还卖方的锁定资金。
    function refundSeller()
        external
        onlySeller
        inState(State.Release)
    {
        emit SellerRefunded();
        // 首先改变状态是很重要的，
        // 否则，使用 `send` 调用的合约可以再次调用这里。
        state = State.Inactive;

        seller.transfer(3 * value);
    }
}