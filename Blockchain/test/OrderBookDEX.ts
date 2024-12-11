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

  describe('Market buy', function () {
    it('Should execute market buy with valid parameters', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost))
        .to.emit(orderBookDEX, 'OrderFilled')
        .withArgs(
          1,
          user1.address,
          user2.address,
          await ETH.getAddress(),
          false,
          price,
          amount,
          amount,
          (await time.latest()) + 1
        );

      expect(await ETH.balanceOf(user2.address)).to.equal(1000n + amount);
    });

    it('Should handle partial fills correctly', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const sellAmount = 5n;
      const buyAmount = 2n;
      const totalCost = price * buyAmount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), sellAmount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, sellAmount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await orderBookDEX.connect(user2).marketBuy([1], [buyAmount], totalCost);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].orderId).to.equal(1);
      expect(orders[0].amount).to.equal(sellAmount);
      expect(orders[0].filled).to.equal(buyAmount);

      expect(await ETH.balanceOf(user2.address)).to.equal(1000n + buyAmount);
      expect(await USDT.balanceOf(user1.address)).to.equal(hre.ethers.parseUnits('10000', 6) + price * buyAmount);
    });

    it('Should revert when executing market buy with order IDs and amounts arrays of different lengths', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [], totalCost))
        .to.be.revertedWithCustomError(orderBookDEX, 'ArrayLengthsMismatch')
        .withArgs(1, 0);
    });

    it('Should revert when executing market buy with zero total USDT amount', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [amount], 0))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidUsdtAmount')
        .withArgs(0);
    });

    it('Should revert when executing market buy with insufficient USDT allowance', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, totalCost);
    });

    it('Should revert when executing market buy with insufficient USDT balance', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1000n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientBalance')
        .withArgs(user2.address, await USDT.balanceOf(user2.address), totalCost);
    });

    it('Should revert when executing market buy with no orders matched', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([999], [amount], totalCost)).to.be.revertedWithCustomError(
        orderBookDEX,
        'NoOrdersMatched'
      );
    });

    it('Should skip orders when trying to fill more than available', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const sellAmount = 1n;
      const buyAmount = 2n;
      const totalCost = price * buyAmount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), sellAmount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, sellAmount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user2).marketBuy([1], [buyAmount], totalCost)).to.be.revertedWithCustomError(
        orderBookDEX,
        'NoOrdersMatched'
      );

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].amount).to.equal(sellAmount);
      expect(orders[0].filled).to.equal(0n);
    });

    it('Should only execute as many orders as the user has sufficient USDT for', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount * 2n);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await orderBookDEX.connect(user2).marketBuy([1, 2], [amount, amount], totalCost);

      const finalBalance = await ETH.balanceOf(user2.address);
      expect(finalBalance).to.equal(1000n + amount);

      const orderIndex = Number((await orderBookDEX.orderInfos(2)).index);
      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      const secondOrder = orders[orderIndex];
      expect(secondOrder.filled).to.equal(0n);
    });

    it('Should refund any excess USDT', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * 2n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      const initialBalance = await USDT.balanceOf(user2.address);
      await orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost);
      const finalBalance = await USDT.balanceOf(user2.address);

      expect(finalBalance).to.equal(initialBalance - price * amount);
    });
  });

  describe('Market sell', function () {
    it('Should execute market sell with valid parameters', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount))
        .to.emit(orderBookDEX, 'OrderFilled')
        .withArgs(
          1,
          user1.address,
          user2.address,
          await ETH.getAddress(),
          true,
          price,
          amount,
          amount,
          (await time.latest()) + 1
        );

      expect(await USDT.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('10000', 6) + totalCost);
    });

    it('Should handle partial fills correctly', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const buyAmount = 2n;
      const sellAmount = 1n;
      const totalCost = price * buyAmount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, buyAmount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), sellAmount);

      await orderBookDEX.connect(user2).marketSell([1], [sellAmount], await ETH.getAddress(), sellAmount);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].orderId).to.equal(1);
      expect(orders[0].amount).to.equal(buyAmount);
      expect(orders[0].filled).to.equal(sellAmount);

      expect(await USDT.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('10000', 6) + price * sellAmount);
      expect(await ETH.balanceOf(user1.address)).to.equal(1000n + sellAmount);
    });

    it('Should revert when executing market sell with order IDs and amounts arrays of different lengths', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user2).marketSell([1], [], await ETH.getAddress(), amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'ArrayLengthsMismatch')
        .withArgs(1, 0);
    });

    it('Should revert when executing market sell with zero total token amount', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), 0))
        .to.be.revertedWithCustomError(orderBookDEX, 'InvalidTokenAmount')
        .withArgs(0);
    });

    it('Should revert when executing market sell with insufficient token allowance', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);

      await expect(orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, amount);
    });

    it('Should revert when executing market sell with insufficient token balance', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4', 6);
      const amount = 2000n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientBalance')
        .withArgs(user2.address, await ETH.balanceOf(user2.address), amount);
    });

    it('Should revert when executing market sell with no orders matched', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await expect(
        orderBookDEX.connect(user2).marketSell([999], [amount], await ETH.getAddress(), amount)
      ).to.be.revertedWithCustomError(orderBookDEX, 'NoOrdersMatched');
    });

    it('Should skip orders when trying to fill more than available', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const buyAmount = 1n;
      const sellAmount = 2n;
      const totalCost = price * buyAmount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, buyAmount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), sellAmount);

      await expect(
        orderBookDEX.connect(user2).marketSell([1], [sellAmount], await ETH.getAddress(), sellAmount)
      ).to.be.revertedWithCustomError(orderBookDEX, 'NoOrdersMatched');

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(1);
      expect(orders[0].amount).to.equal(buyAmount);
      expect(orders[0].filled).to.equal(0n);
    });

    it('Should only execute as many orders as the user has sufficient tokens for', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount * 2n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await orderBookDEX.connect(user2).marketSell([1, 2], [amount, amount], await ETH.getAddress(), amount);

      const finalBalance = await USDT.balanceOf(user2.address);
      expect(finalBalance).to.equal(hre.ethers.parseUnits('10000', 6) + price * amount);

      const orderIndex = Number((await orderBookDEX.orderInfos(2)).index);
      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      const secondOrder = orders[orderIndex];
      expect(secondOrder.filled).to.equal(0n);
    });

    it('Should refund any excess tokens', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = 1n;
      const totalCost = price * amount;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount * 2n);

      const initialBalance = await ETH.balanceOf(user2.address);
      await orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount * 2n);
      const finalBalance = await ETH.balanceOf(user2.address);

      expect(finalBalance).to.equal(initialBalance - amount);
    });
  });
});
