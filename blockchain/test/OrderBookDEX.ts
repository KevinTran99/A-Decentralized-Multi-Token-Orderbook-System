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
    const ethAmount = hre.ethers.parseUnits('1000', 18);

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

  describe('Token unlisting', function () {
    it('Should allow DEFAULT_ADMIN_ROLE to unlist a token', async function () {
      const { orderBookDEX, ETH, owner } = await deployOrderBookDEXFixture();

      await orderBookDEX.listToken(await ETH.getAddress());
      await expect(orderBookDEX.unlistToken(await ETH.getAddress()))
        .to.emit(orderBookDEX, 'TokenUnlisted')
        .withArgs(await ETH.getAddress(), owner.address);

      const tokenInfo = await orderBookDEX.listedTokens(await ETH.getAddress());
      expect(tokenInfo.isListed).to.be.false;
    });

    it('Should not allow non DEFAULT_ADMIN_ROLE to unlist a token', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();

      await orderBookDEX.listToken(await ETH.getAddress());
      await expect(orderBookDEX.connect(user1).unlistToken(await ETH.getAddress())).to.be.revertedWithCustomError(
        orderBookDEX,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('Should not allow unlisting a non-listed token', async function () {
      const { orderBookDEX, ETH } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.unlistToken(await ETH.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should allow orders to be cancelled after token is unlisted', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.unlistToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).cancelOrder(1))
        .to.emit(orderBookDEX, 'OrderCancelled')
        .withArgs(1, user1.address, await ETH.getAddress(), await time.latest());
    });

    it('Should prevent new orders after token is unlisted', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await orderBookDEX.unlistToken(await ETH.getAddress());

      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });
  });

  describe('Create buy order', function () {
    it('Should create a buy order with valid parameters', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.emit(orderBookDEX, 'OrderCreated')
        .withArgs(1, user1.address, await ETH.getAddress(), true, price, amount, (await time.latest()) + 1);

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should revert when creating buy order with zero price', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const amount = hre.ethers.parseUnits('1', 18);

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, totalCost);
    });

    it('Should revert when creating buy order with insufficient USDT balance', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1000', 18);
      const totalCost = price * 1000n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);

      await expect(orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(USDT, 'ERC20InsufficientBalance')
        .withArgs(user1.address, await USDT.balanceOf(user1.address), totalCost);
    });

    it('Should increment order ID after successful creation', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);

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
      const amount = hre.ethers.parseUnits('1', 18);

      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });

    it('Should revert when creating sell order with zero price', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const amount = hre.ethers.parseUnits('1', 18);

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
      const amount = hre.ethers.parseUnits('1', 18);

      await orderBookDEX.listToken(await ETH.getAddress());

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientAllowance')
        .withArgs(await orderBookDEX.getAddress(), 0, amount);
    });

    it('Should revert when creating sell order with insufficient token balance', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('10000', 18);

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);

      await expect(orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount))
        .to.be.revertedWithCustomError(ETH, 'ERC20InsufficientBalance')
        .withArgs(user1.address, await ETH.balanceOf(user1.address), amount);
    });

    it('Should increment order ID after successful creation', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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

      expect(await ETH.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('1000', 18) + amount);
    });

    it('Should handle partial fills correctly', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const sellAmount = hre.ethers.parseUnits('5', 18);
      const buyAmount = hre.ethers.parseUnits('2', 18);
      const totalCost = price * 2n;

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

      expect(await ETH.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('1000', 18) + buyAmount);
      expect(await USDT.balanceOf(user1.address)).to.equal(hre.ethers.parseUnits('10000', 6) + price * 2n);
    });

    it('Should revert when executing market buy with order IDs and amounts arrays of different lengths', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1000', 18);
      const totalCost = price * 1000n;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const sellAmount = hre.ethers.parseUnits('1', 18);
      const buyAmount = hre.ethers.parseUnits('2', 18);
      const totalCost = price * 2n;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount * 2n);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      await orderBookDEX.connect(user2).marketBuy([1, 2], [amount, amount], totalCost);

      const finalBalance = await ETH.balanceOf(user2.address);
      expect(finalBalance).to.equal(hre.ethers.parseUnits('1000', 18) + amount);

      const orderIndex = Number((await orderBookDEX.orderInfos(2)).index);
      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      const secondOrder = orders[orderIndex];
      expect(secondOrder.filled).to.equal(0n);
    });

    it('Should refund any excess USDT', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price * 2n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);

      const initialBalance = await USDT.balanceOf(user2.address);
      await orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost);
      const finalBalance = await USDT.balanceOf(user2.address);

      expect(finalBalance).to.equal(initialBalance - price);
    });
  });

  describe('Market sell', function () {
    it('Should execute market sell with valid parameters', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const buyAmount = hre.ethers.parseUnits('2', 18);
      const sellAmount = hre.ethers.parseUnits('1', 18);
      const totalCost = price * 2n;

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

      expect(await USDT.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('10000', 6) + price);
      expect(await ETH.balanceOf(user1.address)).to.equal(hre.ethers.parseUnits('1000', 18) + sellAmount);
    });

    it('Should revert when executing market sell with order IDs and amounts arrays of different lengths', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('2000', 18);
      const totalCost = price * 2000n;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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
      const buyAmount = hre.ethers.parseUnits('1', 18);
      const sellAmount = hre.ethers.parseUnits('2', 18);
      const totalCost = price;

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
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price * 2n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await orderBookDEX.connect(user2).marketSell([1, 2], [amount, amount], await ETH.getAddress(), amount);

      expect(await USDT.balanceOf(user2.address)).to.equal(hre.ethers.parseUnits('10000', 6) + price);

      const orderIndex = Number((await orderBookDEX.orderInfos(2)).index);
      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      const secondOrder = orders[orderIndex];
      expect(secondOrder.filled).to.equal(0n);
    });

    it('Should refund any excess tokens', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

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

  describe('Cancel order', function () {
    it('Should cancel buy order and refund USDT', async function () {
      const { orderBookDEX, ETH, USDT, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);

      const initialBalance = await USDT.balanceOf(user1.address);

      await expect(orderBookDEX.connect(user1).cancelOrder(1))
        .to.emit(orderBookDEX, 'OrderCancelled')
        .withArgs(1, user1.address, await ETH.getAddress(), (await time.latest()) + 1);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
      expect(await USDT.balanceOf(user1.address)).to.equal(initialBalance + totalCost);
    });

    it('Should cancel sell order and refund tokens', async function () {
      const { orderBookDEX, ETH, user1 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);

      const initialBalance = await ETH.balanceOf(user1.address);

      await expect(orderBookDEX.connect(user1).cancelOrder(1))
        .to.emit(orderBookDEX, 'OrderCancelled')
        .withArgs(1, user1.address, await ETH.getAddress(), (await time.latest()) + 1);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
      expect(await ETH.balanceOf(user1.address)).to.equal(initialBalance + amount);
    });

    it('Should cancel partially filled buy order and refund remaining USDT', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const buyAmount = hre.ethers.parseUnits('2', 18);
      const sellAmount = hre.ethers.parseUnits('1', 18);
      const totalCost = price * 2n;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, buyAmount);

      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), sellAmount);
      await orderBookDEX.connect(user2).marketSell([1], [sellAmount], await ETH.getAddress(), sellAmount);

      const initialBalance = await USDT.balanceOf(user1.address);

      await expect(orderBookDEX.connect(user1).cancelOrder(1))
        .to.emit(orderBookDEX, 'OrderCancelled')
        .withArgs(1, user1.address, await ETH.getAddress(), (await time.latest()) + 1);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
      expect(await USDT.balanceOf(user1.address)).to.equal(initialBalance + price);
    });

    it('Should cancel partially filled sell order and refund remaining tokens', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const sellAmount = hre.ethers.parseUnits('2', 18);
      const buyAmount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await ETH.connect(user1).approve(await orderBookDEX.getAddress(), sellAmount);
      await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, sellAmount);

      await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user2).marketBuy([1], [buyAmount], totalCost);

      const initialBalance = await ETH.balanceOf(user1.address);

      await expect(orderBookDEX.connect(user1).cancelOrder(1))
        .to.emit(orderBookDEX, 'OrderCancelled')
        .withArgs(1, user1.address, await ETH.getAddress(), (await time.latest()) + 1);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
      expect(await ETH.balanceOf(user1.address)).to.equal(initialBalance + (sellAmount - buyAmount));
    });

    it('Should revert when canceling non-existent order', async function () {
      const { orderBookDEX } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.cancelOrder(999))
        .to.be.revertedWithCustomError(orderBookDEX, 'OrderNotFound')
        .withArgs(999);
    });

    it('Should revert when non-maker attempts to cancel order', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);

      await expect(orderBookDEX.connect(user2).cancelOrder(1))
        .to.be.revertedWithCustomError(orderBookDEX, 'NotOrderMaker')
        .withArgs(user2.address, user1.address);
    });
  });

  describe('Fee management', function () {
    describe('Set fee percent', function () {
      it('Should allow admin to set fee percent', async function () {
        const { orderBookDEX } = await deployOrderBookDEXFixture();
        const newFeePercent = 100n;

        await orderBookDEX.setFeePercent(newFeePercent);

        expect(await orderBookDEX.feePercent()).to.equal(newFeePercent);
      });

      it('Should revert when fee is set too high', async function () {
        const { orderBookDEX } = await deployOrderBookDEXFixture();
        const highFeePercent = 201n;

        await expect(orderBookDEX.setFeePercent(highFeePercent))
          .to.be.revertedWithCustomError(orderBookDEX, 'FeeSetToHigh')
          .withArgs(highFeePercent);
      });

      it('Should revert when non-admin tries to set fee percent', async function () {
        const { orderBookDEX, user1 } = await deployOrderBookDEXFixture();
        const newFeePercent = 100n;

        await expect(orderBookDEX.connect(user1).setFeePercent(newFeePercent)).to.be.revertedWithCustomError(
          orderBookDEX,
          'AccessControlUnauthorizedAccount'
        );
      });
    });

    describe('Fee collection and withdrawal', function () {
      it('Should collect fees from market buy orders', async function () {
        const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
        const price = hre.ethers.parseUnits('4000', 6);
        const amount = hre.ethers.parseUnits('1', 18);
        const totalCost = price;
        const feePercent = 100n;
        const expectedFee = (totalCost * feePercent) / 10000n;

        await orderBookDEX.setFeePercent(feePercent);
        await orderBookDEX.listToken(await ETH.getAddress());
        await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
        await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
        await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost + expectedFee);

        await orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost + expectedFee);

        expect(await orderBookDEX.collectedFees()).to.equal(expectedFee);
        expect(await USDT.balanceOf(user1.address)).to.equal(hre.ethers.parseUnits('10000', 6) + totalCost);
      });

      it('Should collect fees from market sell orders', async function () {
        const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
        const price = hre.ethers.parseUnits('4000', 6);
        const amount = hre.ethers.parseUnits('1', 18);
        const totalCost = price;
        const feePercent = 100n;
        const expectedFee = (totalCost * feePercent) / 10000n;

        await orderBookDEX.setFeePercent(feePercent);
        await orderBookDEX.listToken(await ETH.getAddress());
        await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
        await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
        await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

        await orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount);

        expect(await orderBookDEX.collectedFees()).to.equal(expectedFee);
        expect(await USDT.balanceOf(user2.address)).to.equal(
          hre.ethers.parseUnits('10000', 6) + totalCost - expectedFee
        );
      });

      it('Should allow admin to withdraw collected fees', async function () {
        const { orderBookDEX, ETH, USDT, owner, user1, user2 } = await deployOrderBookDEXFixture();
        const price = hre.ethers.parseUnits('4000', 6);
        const amount = hre.ethers.parseUnits('1', 18);
        const totalCost = price;
        const feePercent = 100n;
        const expectedFee = (totalCost * feePercent) / 10000n;

        await orderBookDEX.setFeePercent(feePercent);
        await orderBookDEX.listToken(await ETH.getAddress());
        await ETH.connect(user1).approve(await orderBookDEX.getAddress(), amount);
        await orderBookDEX.connect(user1).createSellOrder(await ETH.getAddress(), price, amount);
        await USDT.connect(user2).approve(await orderBookDEX.getAddress(), totalCost + expectedFee);
        await orderBookDEX.connect(user2).marketBuy([1], [amount], totalCost + expectedFee);

        const initialBalance = await USDT.balanceOf(owner.address);
        await orderBookDEX.withdrawFees(owner.address, expectedFee);

        expect(await orderBookDEX.collectedFees()).to.equal(0);
        expect(await USDT.balanceOf(owner.address)).to.equal(initialBalance + expectedFee);
      });

      it('Should revert when withdrawing more than collected fees', async function () {
        const { orderBookDEX, owner } = await deployOrderBookDEXFixture();
        const withdrawAmount = hre.ethers.parseUnits('1', 6);

        await expect(orderBookDEX.withdrawFees(owner.address, withdrawAmount))
          .to.be.revertedWithCustomError(orderBookDEX, 'InvalidUsdtAmount')
          .withArgs(withdrawAmount);
      });

      it('Should revert when non-admin tries to withdraw fees', async function () {
        const { orderBookDEX, user1 } = await deployOrderBookDEXFixture();
        const withdrawAmount = hre.ethers.parseUnits('1', 6);

        await expect(
          orderBookDEX.connect(user1).withdrawFees(user1.address, withdrawAmount)
        ).to.be.revertedWithCustomError(orderBookDEX, 'AccessControlUnauthorizedAccount');
      });

      it('Should revert when withdrawing to zero address', async function () {
        const { orderBookDEX } = await deployOrderBookDEXFixture();
        const withdrawAmount = hre.ethers.parseUnits('1', 6);

        await expect(orderBookDEX.withdrawFees(hre.ethers.ZeroAddress, withdrawAmount))
          .to.be.revertedWithCustomError(orderBookDEX, 'ZeroAddress')
          .withArgs(hre.ethers.ZeroAddress);
      });

      it('Should revert when withdrawing zero amount', async function () {
        const { orderBookDEX, owner } = await deployOrderBookDEXFixture();

        await expect(orderBookDEX.withdrawFees(owner.address, 0))
          .to.be.revertedWithCustomError(orderBookDEX, 'InvalidUsdtAmount')
          .withArgs(0);
      });
    });
  });

  describe('Get active orders', function () {
    it('Should return all active orders for token', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user2).createSellOrder(await ETH.getAddress(), price, amount);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(2);
      expect(orders[0].maker).to.equal(user1.address);
      expect(orders[0].isBuyOrder).to.be.true;
      expect(orders[1].maker).to.equal(user2.address);
      expect(orders[1].isBuyOrder).to.be.false;
    });

    it('Should return empty array for token with no orders', async function () {
      const { orderBookDEX, ETH } = await deployOrderBookDEXFixture();

      await orderBookDEX.listToken(await ETH.getAddress());

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
    });

    it('Should not return filled orders', async function () {
      const { orderBookDEX, ETH, USDT, user1, user2 } = await deployOrderBookDEXFixture();
      const price = hre.ethers.parseUnits('4000', 6);
      const amount = hre.ethers.parseUnits('1', 18);
      const totalCost = price;

      await orderBookDEX.listToken(await ETH.getAddress());
      await USDT.connect(user1).approve(await orderBookDEX.getAddress(), totalCost);
      await ETH.connect(user2).approve(await orderBookDEX.getAddress(), amount);

      await orderBookDEX.connect(user1).createBuyOrder(await ETH.getAddress(), price, amount);
      await orderBookDEX.connect(user2).marketSell([1], [amount], await ETH.getAddress(), amount);

      const orders = await orderBookDEX.getActiveOrders(await ETH.getAddress());
      expect(orders.length).to.equal(0);
    });

    it('Should revert when querying unlisted token', async function () {
      const { orderBookDEX, ETH } = await deployOrderBookDEXFixture();

      await expect(orderBookDEX.getActiveOrders(await ETH.getAddress()))
        .to.be.revertedWithCustomError(orderBookDEX, 'TokenNotListed')
        .withArgs(await ETH.getAddress());
    });
  });

  describe('Special functions', function () {
    describe('Fallback function', function () {
      it('Should revert when calling non-existent function', async function () {
        const { orderBookDEX, user1 } = await deployOrderBookDEXFixture();

        await expect(
          user1.sendTransaction({
            to: await orderBookDEX.getAddress(),
            data: '0x12345678',
          })
        ).to.be.reverted;
      });
    });

    describe('Receive function', function () {
      it('Should revert when sending ETH directly to the contract', async function () {
        const { orderBookDEX, user1 } = await deployOrderBookDEXFixture();

        await expect(
          user1.sendTransaction({
            to: await orderBookDEX.getAddress(),
            value: hre.ethers.parseEther('1.0'),
          })
        ).to.be.reverted;
      });
    });
  });
});
