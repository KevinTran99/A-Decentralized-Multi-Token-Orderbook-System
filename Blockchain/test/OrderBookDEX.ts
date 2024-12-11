import { expect } from 'chai';
import hre from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

describe('OrderBookDEX', function () {
  async function deployOrderBookDEXFixture() {
    const [owner, user1, user2, user3] = await hre.ethers.getSigners();

    const ERC20Mock = await hre.ethers.getContractFactory('ERC20Mock');
    const USDT = await ERC20Mock.deploy('USDT', 'USDT', 6);
    const ETH = await ERC20Mock.deploy('Ethereum', 'ETH', 18);

    const OrderBookDEX = await hre.ethers.getContractFactory('OrderBookDEX');
    const orderBookDEX = await OrderBookDEX.deploy(await USDT.getAddress());

    const usdtAmount = hre.ethers.parseUnits('10000', 6);
    const ethAmount = 1000n;

    await USDT.transfer(user1.address, usdtAmount);
    await USDT.transfer(user2.address, usdtAmount);
    await USDT.transfer(user3.address, usdtAmount);
    await ETH.transfer(user1.address, ethAmount);
    await ETH.transfer(user2.address, ethAmount);
    await ETH.transfer(user3.address, ethAmount);

    return { orderBookDEX, USDT, ETH, owner, user1, user2, user3 };
  }

  describe('Deployment', function () {
    it('Should assign deployer the DEFAULT_ADMIN_ROLE and PAIR_LISTER_ROLE', async function () {
      const { orderBookDEX, owner } = await deployOrderBookDEXFixture();
      const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000';
      const PAIR_LISTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('PAIR_LISTER_ROLE'));

      expect(await orderBookDEX.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
      expect(await orderBookDEX.hasRole(PAIR_LISTER_ROLE, owner.address)).to.be.true;
    });

    it('Should set the correct USDT address', async function () {
      const { orderBookDEX, USDT } = await deployOrderBookDEXFixture();

      expect(await orderBookDEX.USDT()).to.equal(await USDT.getAddress());
    });
  });

  describe('Token listing', function () {
    it('Should allow PAIR_LISTER_ROLE to list a token', async function () {
      const { orderBookDEX, ETH, owner } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(await ETH.getAddress()))
        .to.emit(orderBookDEX, 'TokenListed')
        .withArgs(await ETH.getAddress(), 18, owner.address);
    });

    it('Should not allow non PAIR_LISTER_ROLE to list a token', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.connect(user1).listToken(await ETH.getAddress())).to.be.revertedWithCustomError(
        orderBookDEX,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('Should not allow listing of zero address', async function () {
      const { orderBookDEX } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(hre.ethers.ZeroAddress))
        .to.be.revertedWithCustomError(orderBookDEX, 'ZeroAddress')
        .withArgs(hre.ethers.ZeroAddress);
    });

    it('Should not allow listing an already listed token', async function () {
      const { orderBookDEX, ETH } = await deployOrderBookDEXFixture();

      await orderBookDEX.listToken(await ETH.getAddress());
      await expect(orderBookDEX.listToken(await ETH.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenAlreadyListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should not allow listing USDT as a trading token pair', async function () {
      const { orderBookDEX, USDT } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.listToken(await USDT.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'CannotListUsdt')
        .withArgs(await USDT.getAddress());
    });
  });

  describe('Create buy order', function () {
    it('Should create a buy order with valid parameters', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.emit(orderBookDEX, 'OrderCreated')
        .withArgs(1, user1.address, await ETH.getAddress(), true, price, amount, await time.latest());

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].orderId).to.equal(1);
      expect(orders[0].maker).to.equal(user1.address);
      expect(orders[0].token).to.equal(await ETH.getAddress());
      expect(orders[0].isBuyOrder).to.be.true;
      expect(orders[0].price).to.equal(price);
      expect(orders[0].amount).to.equal(amount);
      expect(orders[0].filled).to.equal(0);
    });

    it('Should revert when creating buy order for unlisted token', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should revert when creating buy order with zero price', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const amount = 1n;

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), 0, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidPrice')
        .withArgs(0);
    });

    it('Should revert when creating buy order with zero amount', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, 0))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidAmount')
        .withArgs(0);
    });

    it('Should revert when creating buy order with insufficient USDT allowance', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, totalCost);
    });

    it('Should revert when creating buy order with insufficient USDT balance', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1000n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientBalance')
        .withArgs(user1.address, await USDT.balanceOf(user1.address), totalCost);
    });

    it('Should increment order ID after successful creation', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      expect(await orderBookDEX.orderId()).to.equal(0);

      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);

      expect(await orderBookDEX.orderId()).to.equal(1);
    });
  });

  describe('Create sell order', function () {
    it('Should create a sell order with valid parameters', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.emit(orderBookDEX, 'OrderCreated')
        .withArgs(1, user1.address, await ETH.getAddress(), false, price, amount, (await time.latest()) + 1);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].orderId).to.equal(1);
      expect(orders[0].maker).to.equal(user1.address);
      expect(orders[0].token).to.equal(await ETH.getAddress());
      expect(orders[0].isBuyOrder).to.be.false;
      expect(orders[0].price).to.equal(price);
      expect(orders[0].amount).to.equal(amount);
      expect(orders[0].filled).to.equal(0);
    });

    it('Should revert when creating sell order for unlisted token', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;

      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should revert when creating sell order with zero price', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const amount = 1n;

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), 0, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidPrice')
        .withArgs(0);
    });

    it('Should revert when creating sell order with zero amount', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, 0))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidAmount')
        .withArgs(0);
    });

    it('Should revert when creating sell order with insufficient token allowance', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, amount);
    });

    it('Should revert when creating sell order with insufficient token balance', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 10000n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientBalance')
        .withArgs(user1.address, await ETH.balanceOf(user1.address), amount);
    });

    it('Should increment order ID after successful creation', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      expect(await orderBookDEX.orderId()).to.equal(0);

      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);

      expect(await orderBookDEX.orderId()).to.equal(1);
    });
  });
});
