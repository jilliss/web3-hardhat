// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.7.0 <0.9.0;

contract Frozeable {
    bool private _frozen = false;
    bool public frozen;

    modifier notFrozen() {
        require(!_frozen, "Inactive Contract.");
        frozen = _frozen;
        _;
    }

    function freeze() internal {
        _frozen = true;
        frozen = _frozen;

    }
}

contract SimplePaymentChannel is Frozeable {
    address payable public sender;    // 发送支付的账户。
    address payable public recipient; // 接收支付的账户。
    uint256 public expiration;        // 超时，如果接收者从未关闭。

    constructor (address payable recipientAddress, uint256 duration)
        payable
    {
        sender = payable(msg.sender);
        recipient = recipientAddress;
        expiration = block.timestamp + duration;
    }

    /// 接收者可以随时通过提供发送者的签名金额来关闭通道。
    /// 接收者将收到该金额，其余部分将返回给发送者
    function close(uint256 amount, bytes memory signature)
        external
        notFrozen
    {
        require(msg.sender == recipient);
        require(isValidSignature(amount, signature));

        recipient.transfer(amount);
        freeze();
        sender.transfer(address(this).balance);
    }

    /// 发送者可以随时延长到期时间
    function extend(uint256 newExpiration)
        external
        notFrozen
    {
        require(msg.sender == sender);
        require(newExpiration > expiration);

        expiration = newExpiration;
    }

    /// 如果超时到达而接收者未关闭通道，则以太币将返回给发送者。
    function claimTimeout()
        external
        notFrozen
    {
        require(block.timestamp >= expiration);
        freeze();
        sender.transfer(address(this).balance);
    }

    function isValidSignature(uint256 amount, bytes memory signature)
        internal
        view
        returns (bool)
    {
        bytes32 message = prefixed(keccak256(abi.encodePacked(this, amount)));
        // 检查签名是否来自支付发送者
        return recoverSigner(message, signature) == sender;
    }

    /// 以下所有函数均来自于 '创建和验证签名' 章节。
    function splitSignature(bytes memory sig)
        internal
        pure
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        require(sig.length == 65);

        assembly {
            // 前 32 个字节，长度前缀后
            r := mload(add(sig, 32))
            // 第二个 32 个字节
            s := mload(add(sig, 64))
            // 最后一个字节（下一个 32 个字节的第一个字节）
            v := byte(0, mload(add(sig, 96)))
        }
        return (v, r, s);
    }

    function recoverSigner(bytes32 message, bytes memory sig)
        internal
        pure
        returns (address)
    {
        (uint8 v, bytes32 r, bytes32 s) = splitSignature(sig);
        return ecrecover(message, v, r, s);
    }

    /// 构建一个带前缀的哈希，以模仿 eth_sign 的行为。
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}