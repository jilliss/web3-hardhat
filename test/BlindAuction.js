const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BlindAuction", function () {
  let auction;
  let beneficiary, bidder1, bidder2;
  const biddingTime = 3600;
  const revealTime = 3600;

  before(async () => {
    [beneficiary, bidder1, bidder2] = await ethers.getSigners();
    const BlindAuction = await ethers.getContractFactory("BlindAuction");
    auction = await BlindAuction.deploy(biddingTime, revealTime, beneficiary.address);
  });

  describe("构造函数", () => {
    it("正确设置受益人", async () => {
      expect(await auction.beneficiary()).to.equal(beneficiary.address);
    });
  });
  describe("投标阶段", () => {
    it("bidder1", async () => {
      // 1. 验证当前时间在投标期内
      const currentTime = (await ethers.provider.getBlock("latest")).timestamp;
      const biddingEnd = await auction.biddingEnd();
      expect(currentTime).to.be.lessThan(biddingEnd);

      // 2. 生成正确的 blindedBid
      const value = 100;
      const fake = false;
      const secret = ethers.encodeBytes32String("secret");
      const blindedBid = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bool", "bytes32"],
          [value, fake, secret]
        )
      );

      // 3. 调用 bid() 并验证交易成功
      await expect(
        auction.connect(bidder1).bid(blindedBid, { value: value })
      ).to.not.be.reverted;

      // 4. 验证投标数据已存储
      const bidEntry = await auction.bids(bidder1.address, 0);
      expect(bidEntry.blindedBid).to.equal(blindedBid);
      expect(bidEntry.deposit).to.equal(value);
    });
    it("bidder2", async () => {
      // 1. 验证当前时间在投标期内
      const currentTime = (await ethers.provider.getBlock("latest")).timestamp;
      const biddingEnd = await auction.biddingEnd();
      expect(currentTime).to.be.lessThan(biddingEnd);

      // 2. 生成正确的 blindedBid
      const value = 200;
      const fake = false;
      const secret = ethers.encodeBytes32String("secret2");
      const blindedBid = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["uint256", "bool", "bytes32"],
          [value, fake, secret]
        )
      );

      // 3. 调用 bid() 并验证交易成功
      await expect(
        auction.connect(bidder2).bid(blindedBid, { value: value })
      ).to.not.be.reverted;
      // 4. 验证投标数据已存储
      const bidEntry = await auction.bids(bidder2.address, 0);
      expect(bidEntry.blindedBid).to.equal(blindedBid);
      expect(bidEntry.deposit).to.equal(value);
    });
  });



  describe("test reveal", () => {
    let alice, bob;
    const secretAlice1 = ethers.encodeBytes32String("alice_secret1");
    const secretAlice2 = ethers.encodeBytes32String("alice_secret2");
    const secretBob = ethers.encodeBytes32String("bob_secret");

    before(async () => {
      [alice, bob] = await ethers.getSigners();

      // Alice 2
      const blindedBidAlice1 = generateBlindedBid(100n, false, secretAlice1);
      const blindedBidAlice2 = generateBlindedBid(150n, false, secretAlice2);
      await auction.connect(alice).bid(blindedBidAlice1, { value: 100n });
      await auction.connect(alice).bid(blindedBidAlice2, { value: 150n });

      // Bob 1
      const blindedBidBob = generateBlindedBid(200n, false, secretBob);
      await auction.connect(bob).bid(blindedBidBob, { value: 200n });
      // update time 
      await advanceTimeTo(await auction.biddingEnd() + 1n);
    });

    it("inove reveal", async () => {
      // Alice 
      await expect(
        auction.connect(alice).reveal(
          [100n, 150n],   // values
          [false, false], // fakes
          [secretAlice1, secretAlice2] // secrets
        )
      ).to.not.be.reverted;

      // Bob 
      await expect(
        auction.connect(bob).reveal(
          [200n],
          [false],
          [secretBob]
        )
      ).to.be.reverted;

      // 验证最高价来自 Bob
      // expect(await auction.highestBid()).to.equal(200n);
      // expect(await auction.highestBidder()).to.equal(bob.address);
    });

    /*     it("未调用 reveal 的投标无效", async () => {
          // 仅 Alice 披露，Bob 未披露
          await auction.connect(alice).reveal(
            [100n, 150n],
            [false, false],
            [secretAlice1, secretAlice2]
          );
    
          // 最高价应为 Alice 的 150（Bob 未披露，其 200 无效）
          expect(await auction.highestBid()).to.equal(150n);
          expect(await auction.highestBidder()).to.equal(alice.address);
        }); */


  });

  // 辅助函数：生成 blindedBid
  function generateBlindedBid (value, fake, secret) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "bool", "bytes32"],
        [value, fake, secret]
      )
    );
  }

  // 辅助函数：推进时间
  async function advanceTimeTo (targetTime) {
    const currentTime = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    if (currentTime < targetTime) {
      await ethers.provider.send("evm_increaseTime", [Number(targetTime - currentTime)]);
      await ethers.provider.send("evm_mine");
    }
  }



});