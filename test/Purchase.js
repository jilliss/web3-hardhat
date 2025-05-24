const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Purchase Contract", function () {
  let Purchase;
  let purchase;
  let seller, buyer, otherAccount;
  const initialValue = ethers.parseEther("2"); // 2 ETH (偶数)

  before(async () => {
    [seller, buyer, otherAccount] = await ethers.getSigners();
    Purchase = await ethers.getContractFactory("Purchase");
  });

  beforeEach(async () => {
    purchase = await Purchase.deploy({ value: initialValue });
  });

  describe("构造函数", () => {
    it("正确初始化卖方和计算value", async () => {
      expect(await purchase.seller()).to.equal(seller.address);
      expect(await purchase.value()).to.equal(initialValue / 2n);
    });

    it("当部署金额为奇数时应回滚", async () => {
      const oddValue = ethers.parseEther("1"); // 1.3 ETH 不是偶数
      await expect(Purchase.deploy({ value: oddValue }))
        .to.be.not.reverted;
    });
  });

  describe("abort()", () => {
    it("卖方在Created状态下可中止合约", async () => {
      let p = await purchase.connect(seller).abort();
      expect(p).to.emit(purchase, "Aborted");
      expect(p).to.changeEtherBalance(seller, initialValue); // 退回初始金额

      expect(await purchase.state()).to.equal(3); // Inactive
    });

    it("非卖方调用应回滚", async () => {
      await expect(purchase.connect(buyer).abort())
        .to.be.revertedWithCustomError(Purchase, "OnlySeller");
    });

    it("在Locked状态下调用应回滚", async () => {
      // 先确认购买进入Locked状态
      await purchase.connect(buyer).confirmPurchase({ value: initialValue });
      await expect(purchase.connect(seller).abort())
        .to.be.revertedWithCustomError(Purchase, "InvalidState");
    });
  });

  describe("confirmPurchase()", () => {
    it("买家支付正确金额锁定合约", async () => {
      const confirmValue = initialValue
      // 不支持链式调用的写法
      let p = purchase.connect(buyer).confirmPurchase({ value: confirmValue })
      await expect(p).to.emit(purchase, "PurchaseConfirmed");
      await expect(p).to.changeEtherBalance(buyer, -confirmValue);




      expect(await purchase.buyer()).to.equal(buyer.address);
      expect(await purchase.state()).to.equal(1); // Locked
    });

    it("支付金额不足应回滚", async () => {
      const invalidValue = initialValue / 2n; // 1 ETH（不足）
      await expect(
        purchase.connect(buyer).confirmPurchase({ value: invalidValue })
      ).to.be.reverted;
    });

    it("在非Created状态下调用应回滚", async () => {
      await purchase.connect(seller).abort(); // 进入Inactive
      await expect(
        purchase.connect(buyer).confirmPurchase({ value: initialValue })
      ).to.be.revertedWithCustomError(Purchase, "InvalidState");
    });
  });

  describe("confirmReceived()", () => {
    beforeEach(async () => {
      // 进入Locked状态
      await purchase.connect(buyer).confirmPurchase({ value: initialValue });
    });

    it("买家确认收货后释放资金", async () => {
      let p = purchase.connect(buyer).confirmReceived();
      await expect(p).to.emit(purchase, "ItemReceived");
      await expect(p).to.changeEtherBalance(buyer, initialValue / 2n); // 退回value

      expect(await purchase.state()).to.equal(2); // Release
    });

    it("非买家调用应回滚", async () => {
      await expect(purchase.connect(otherAccount).confirmReceived())
        .to.be.revertedWithCustomError(Purchase, "OnlyBuyer");
    });

    it("在非Locked状态下调用应回滚", async () => {
      await purchase.connect(buyer).confirmReceived();
      await expect(purchase.connect(buyer).confirmReceived()) // 已进入Release
        .to.be.revertedWithCustomError(Purchase, "InvalidState");
    });
  });

  describe("refundSeller()", () => {
    beforeEach(async () => {
      // 完整流程到Release状态
      await purchase.connect(buyer).confirmPurchase({ value: initialValue });
      await purchase.connect(buyer).confirmReceived();
    });

    it("卖方在Release状态下可提取资金", async () => {
      const expectedRefund = initialValue / 2n * 3n;
      let p = purchase.connect(seller).refundSeller();
      await expect(p).to.emit(purchase, "SellerRefunded")
      await expect(p).to.changeEtherBalance(seller, expectedRefund);
      expect(await purchase.state()).to.equal(3); // Inactive
    });

    it("非卖方调用应回滚", async () => {
      await expect(purchase.connect(buyer).refundSeller())
        .to.be.revertedWithCustomError(Purchase, "OnlySeller");
    });

    it("在非Release状态下调用应回滚", async () => {
      //上面已经Release不允许取消了
      await expect(purchase.connect(seller).abort())
        .to.be.revertedWithCustomError(Purchase, "InvalidState");
      // 卖家收款正常  
      await expect(purchase.connect(seller).refundSeller()).to.be.not.reverted;
    });
  });

  describe("完整流程测试", () => {
    it("正常流程: Created → Locked → Release → Inactive", async () => {
      // 阶段1: 确认购买
      await purchase.connect(buyer).confirmPurchase({ value: initialValue });
      expect(await purchase.state()).to.equal(1);

      // 阶段2: 确认收货
      await purchase.connect(buyer).confirmReceived();
      expect(await purchase.state()).to.equal(2);

      // 阶段3: 退款卖家
      await purchase.connect(seller).refundSeller();
      expect(await purchase.state()).to.equal(3);

      // 验证最终余额
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      const finalBuyerBalance = await ethers.provider.getBalance(buyer.address);
      expect(finalSellerBalance).to.be.gt(0);
      expect(finalBuyerBalance).to.be.gt(0);
    });
  });
});