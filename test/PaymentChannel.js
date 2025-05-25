const { expect } = require("chai");
const { ethers } = require("hardhat");
const { Wallet } = require("ethers");

describe("SimplePaymentChannel", function () {
  let channel;
  let sender, recipient, other;
  const initialAmount = ethers.parseEther("1");
  const duration = 3600; // 1小时

  // 签名辅助函数
  async function signAmount (signer, contractAddress, amount) {
    const messageHash = ethers.solidityPackedKeccak256(
      ["address", "uint256"],
      [contractAddress, amount]
    );
    const prefixedHash = ethers.hashMessage(ethers.getBytes(messageHash));
    const signature = await signer.signMessage(ethers.getBytes(messageHash));
    return signature;
  }

  before(async () => {
    [sender, recipient, other] = await ethers.getSigners();
  });

  beforeEach(async () => {
    const SimplePaymentChannel = await ethers.getContractFactory("SimplePaymentChannel");
    channel = await SimplePaymentChannel.deploy(
      recipient.address,
      duration,
      { value: initialAmount }
    );
  });

  describe("构造函数", () => {
    it("正确初始化发送者、接收者和超时时间", async () => {
      expect(await channel.sender()).to.equal(sender.address);
      expect(await channel.recipient()).to.equal(recipient.address);
      const expectedExpiration = (await ethers.provider.getBlock("latest")).timestamp + duration;
      expect(await channel.expiration()).to.equal(expectedExpiration);
    });
  });

  describe("close()", () => {
    it("接收者使用有效签名可关闭通道", async () => {
      const amount = ethers.parseEther("0.5");
      const signature = await signAmount(sender, await channel.getAddress(), amount);

      await expect(
        channel.connect(recipient).close(amount, signature))
        .to.changeEtherBalances(
          [recipient, sender],
          [amount, initialAmount - amount]
        );
      expect(await channel.frozen()).to.be.true;
    });

    it("非接收者调用应回滚", async () => {
      const signature = await signAmount(sender, await channel.getAddress(), 0);
      await expect(channel.connect(other).close(0, signature))
        .to.be.reverted;

      // .revertedWith("require failed: msg.sender == recipient");
    });

    it("无效签名应回滚", async () => {
      const invalidSignature = await signAmount(other, await channel.getAddress(), 0);
      await expect(channel.connect(recipient).close(0, invalidSignature))
        .to.be.reverted;
    });
  });

  describe("extend()", () => {
    it("发送者可延长超时时间", async () => {
      const newExpiration = (await channel.expiration()) + 1000n;
      await channel.connect(sender).extend(newExpiration);
      expect(await channel.expiration()).to.equal(newExpiration);
    });

    it("非发送者调用应回滚", async () => {
      await expect(channel.connect(recipient).extend(0))
        .to.be.reverted;
    });

    it("新超时必须大于当前", async () => {
      const currentExpiration = await channel.expiration();
      await expect(channel.connect(sender).extend(currentExpiration - 1n))
        .to.be.reverted;
    });
  });

  describe("claimTimeout()", () => {
    it("超时后发送者可取回资金", async () => {
      await ethers.provider.send("evm_increaseTime", [duration + 1]);
      await ethers.provider.send("evm_mine");

      await expect(channel.connect(sender).claimTimeout())
        .to.changeEtherBalance(sender, initialAmount);

      expect(await channel.frozen()).to.be.true;
    });

    it("未超时调用应回滚", async () => {
      await expect(channel.connect(sender).claimTimeout())
        .to.be.reverted;
    });
  });

  describe("冻结状态", () => {
    beforeEach(async () => {
      // 先关闭通道触发冻结
      const signature = await signAmount(sender, await channel.getAddress(), 0);
      await channel.connect(recipient).close(0, signature);
    });

    it("冻结后禁止所有操作", async () => {
      await expect(channel.connect(recipient).close(0, "0x"))
        .to.be.revertedWith("Inactive Contract.");
      await expect(channel.connect(sender).extend(0))
        .to.be.revertedWith("Inactive Contract.");
      await expect(channel.connect(sender).claimTimeout())
        .to.be.revertedWith("Inactive Contract.");
    });
  });


});

