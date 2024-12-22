// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title OrderBookDEX
 * @dev A decentralized exchange implementing an order book model for ERC20/USDT trading pairs
 */
contract OrderBookDEX is ReentrancyGuard, AccessControl {
    /// @notice USDT contract used as the quote currency for all trading pairs
    IERC20 public immutable USDT;

    /// @notice Fee percentage charged on trades (2 decimals: 100 = 1%)
    uint256 public feePercent;

    /// @notice USDT fees collected from trades
    uint256 public collectedFees;

    /// @notice Role for accounts that can list new trading pairs
    bytes32 public constant PAIR_LISTER_ROLE = keccak256("PAIR_LISTER_ROLE");

    /// @notice Struct to store token information
    /// Decimal places for the token
    /// Whether the token is approved for trading
    struct TokenInfo {
        uint8 decimals;
        bool isListed;
    }

    /// @notice Struct to store order information
    /// Unique identifier for the order
    /// Address that created the order
    /// Token address being traded
    /// True if this is a buy order, false for sell order
    /// Price per token in USDT (scaled by USDT decimals)
    /// Amount of tokens to trade
    /// Amount of tokens already filled
    struct Order {
        uint256 orderId;
        address maker;
        address token;
        bool isBuyOrder;
        uint256 price;
        uint256 amount;
        uint256 filled;
    }

    /// @notice Struct to store order information
    /// Token address being traded in the order
    /// Index position in the activeOrdersByToken array
    struct OrderInfo {
        address token;
        uint256 index;
    }

    /// @notice Counter for generating unique order IDs
    uint256 public orderId;

    /// @notice Mapping of token address to its listing information
    mapping(address => TokenInfo) public listedTokens;

    /// @notice Mapping of token address to its active orders
    mapping(address => Order[]) public activeOrdersByToken;

    /// @notice Mapping from order ID to its order information
    mapping(uint256 => OrderInfo) public orderInfos;

    /// @notice Emitted when a new token is listed for trading
    /// Token contract address that was listed
    /// Number of decimal places for the token
    /// Address of the account that listed the token
    event TokenListed(address indexed token, uint8 decimals, address indexed lister);

    /// @notice Emitted when a token is unlisted from trading
    /// Token contract address that was unlisted
    /// Address of the account that unlisted the token
    event TokenUnlisted(address indexed token, address indexed unlister);

    /// @notice Emitted when a new order is created
    /// Unique identifier of the created order
    /// Address that created the order
    /// Token address being traded
    /// True if this is a buy order
    /// Price per token in USDT
    /// Amount of tokens in the order
    /// Block timestamp when order was created
    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address indexed token,
        bool isBuyOrder,
        uint256 price,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when an order is filled
    /// Order ID that was filled
    /// Address that created the order
    /// Address that filled the order
    /// Token address being traded
    /// True if this is a buy order
    /// Price per token in USDT
    /// Amount of tokens in the order
    /// Amount of tokens filled
    /// Block timestamp when fill occurred
    event OrderFilled(
        uint256 indexed orderId,
        address indexed maker,
        address indexed taker,
        address token,
        bool isBuyOrder,
        uint256 price,
        uint256 filled,
        uint256 usdtAmount,
        uint256 feeAmount,
        uint256 timestamp
    );

    /// @notice Emitted when an order is cancelled by its maker
    /// Order ID that was cancelled
    /// Address that created the order
    /// Token address being traded
    /// Block timestamp when cancellation occured
    event OrderCancelled(
        uint256 indexed orderId,
        address indexed maker,
        address indexed token,
        uint256 timestamp
    );

    /// @notice Error thrown when zero address is provided
    /// @param zeroAddress The invalid zero address
    error ZeroAddress(address zeroAddress);
    
    /// @notice Error thrown when price is set to zero
    /// @param price The invalid zero price
    error InvalidPrice(uint256 price);

    /// @notice Error thrown when amount is set to zero
    /// @param amount The invalid zero amount
    error InvalidAmount(uint256 amount);

    /// @notice Error thrown when attempting to interact with an unlisted token
    /// @param token The token address that is not listed
    error TokenNotListed(address token);

    /// @notice Error thrown when token is already listed for trading
    /// @param token The token address that is already listed
    error TokenAlreadyListed(address token);

    /// @notice Error thrown when attempting to list USDT as a trading token
    /// @param token The USDT token address
    error CannotListUsdt(address token);

    /// @notice Error thrown when order ID does not exist
    /// @param order The order ID that was not found
    error OrderNotFound(uint256 order);

    /// @notice Error thrown when non-maker attempts to modify order
    /// @param caller Address attempting to modify the order
    /// @param maker Address of the actual order maker
    error NotOrderMaker(address caller, address maker);

    /// @notice Error thrown when no orders were matched in a market order
    error NoOrdersMatched();

    /// @notice Error thrown when input array lengths do not match
    /// @param idsLength Length of order IDs array
    /// @param amountsLength Length of amounts array
    error ArrayLengthsMismatch(uint256 idsLength, uint256 amountsLength);

    /// @notice Error thrown when fee percentage exceeds maximum
    /// @param feePercent The invalid fee percentage
    error FeeSetToHigh(uint256 feePercent);

    /// @notice Error thrown when invalid USDT amount is provided
    /// @param amount The invalid USDT amount
    error InvalidUsdtAmount(uint256 amount);

    /// @notice Error thrown when invalid token amount is provided
    /// @param amount The invalid token amount
    error InvalidTokenAmount(uint256 amount);

    /// @notice Ensures the token is listed before executing the function
    /// @param _token Token address to check
    modifier onlyListed(address _token) {
        if (!listedTokens[_token].isListed) {
            revert TokenNotListed(_token);
        }
        _;
    }

    /// @notice Ensures the price is not zero
    /// @param _price Price to validate
    modifier validPrice(uint256 _price) {
        if (_price == 0) {
            revert InvalidPrice(_price);
        }
        _;
    }

    /// @notice Ensures the amount is not zero
    /// @param _amount Amount to validate
    modifier validAmount(uint256 _amount) {
        if (_amount == 0) {
            revert InvalidAmount(_amount);
        }
        _;
    }

    /**
     * @dev Contract constructor
     * @param _usdt Address of the USDT contract
     */
    constructor(address _usdt) {
        if (_usdt == address(0)) revert ZeroAddress(_usdt);
        USDT = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAIR_LISTER_ROLE, msg.sender);
    }

    /// @notice Lists a new token for trading against USDT
    /// @dev Verifies ERC20 compliance through decimals() call
    /// @param _token Token contract address
    function listToken(address _token) external onlyRole(PAIR_LISTER_ROLE) {
        if (_token == address(0)) revert ZeroAddress(_token);
        if (listedTokens[_token].isListed) revert TokenAlreadyListed(_token);
        if (_token == address(USDT)) revert CannotListUsdt(_token);

        uint8 tokenDecimals = IERC20Metadata(_token).decimals();

        listedTokens[_token] = TokenInfo({
            decimals: tokenDecimals,
            isListed: true
        });
        
        emit TokenListed(_token, tokenDecimals, msg.sender);
    }

    /// @notice Unlists a token from trading against USDT
    /// @dev Existing orders can still be cancelled and filled
    /// @param _token Token contract address
    function unlistToken(address _token) external onlyRole(DEFAULT_ADMIN_ROLE) onlyListed(_token) {
        listedTokens[_token].isListed = false;

        emit TokenUnlisted(_token, msg.sender);
    }

    /// @notice Creates a buy order for a listed token
    /// @dev Locks USDT payment in contract until order is filled or cancelled
    /// @param _token Token contract address
    /// @param _price Price per token in USDT
    /// @param _amount Amount of tokens to buy
    /// @return orderId Unique identifier for the created order
    function createBuyOrder(address _token, uint256 _price, uint256 _amount) external onlyListed(_token) validPrice(_price) validAmount(_amount) nonReentrant returns (uint256) {
        uint256 decimals = listedTokens[_token].decimals;
        uint256 totalCost = _price * (_amount / (10 ** decimals));
        USDT.transferFrom(msg.sender, address(this), totalCost);

        return _createOrder(_token, true, _price, _amount);
    }

    /// @notice Creates a sell order for a listed token
    /// @dev Locks tokens in contract until order is filled or cancelled
    /// @param _token Token contract address
    /// @param _price Price per token in USDT
    /// @param _amount Amount of tokens to sell
    /// @return orderId Unique identifier for the created order
    function createSellOrder(address _token, uint256 _price, uint256 _amount) external onlyListed(_token) validPrice(_price) validAmount(_amount) nonReentrant returns (uint256) {
        IERC20(_token).transferFrom(msg.sender, address(this), _amount);

        return _createOrder(_token, false, _price, _amount);
    }

    /// @notice Executes market buy orders against existing sell orders
    /// @dev Processes multiple orders in single transaction, skipping invalid ones
    /// @param _orderIds Array of order IDs to buy from
    /// @param _amounts Array of amounts to buy from each order
    /// @param _totalUsdt Total USDT to spend on orders
    function marketBuy(uint256[] calldata _orderIds, uint256[] calldata _amounts, uint256 _totalUsdt) external nonReentrant {
        if (_orderIds.length != _amounts.length) revert ArrayLengthsMismatch(_orderIds.length, _amounts.length);
        if (_totalUsdt == 0) revert InvalidUsdtAmount(_totalUsdt);

        USDT.transferFrom(msg.sender, address(this), _totalUsdt);

        uint256 remainingUsdt = _totalUsdt;
        uint256 ordersMatched;
        
        for (uint256 i = 0; i < _orderIds.length; i++) {
            OrderInfo memory orderInfo = orderInfos[_orderIds[i]];
            if (orderInfo.token == address(0)) {
                continue;
            }

            Order storage order = activeOrdersByToken[orderInfo.token][orderInfo.index];
            uint256 amountWanted = _amounts[i];

            if (order.orderId != _orderIds[i] ||
                order.isBuyOrder ||
                order.token != orderInfo.token ||
                order.amount - order.filled < amountWanted ||
                amountWanted == 0) {
                continue;
            }

            uint256 decimals = listedTokens[order.token].decimals;
            uint256 orderCost = order.price * (amountWanted / (10 ** decimals));
            uint256 fee = (orderCost * feePercent) / 10000;
            
            if (orderCost + fee > remainingUsdt) {
                continue;
            }

            order.filled += amountWanted;
            remainingUsdt -= orderCost + fee;
            collectedFees += fee;
            ordersMatched++;

            USDT.transfer(order.maker, orderCost);
            IERC20(order.token).transfer(msg.sender, amountWanted);

            emit OrderFilled(order.orderId, order.maker, msg.sender, order.token, order.isBuyOrder, order.price, amountWanted, orderCost, fee, block.timestamp);

            if (order.filled == order.amount) {
                _removeOrder(_orderIds[i], orderInfo.token, orderInfo.index);
            }
        }

        if (ordersMatched == 0) revert NoOrdersMatched();

        if (remainingUsdt > 0) {
            USDT.transfer(msg.sender, remainingUsdt);
        }
    }

    /// @notice Executes market sell orders against existing buy orders
    /// @dev Processes multiple orders in single transaction, skipping invalid ones
    /// @param _orderIds Array of order IDs to sell to
    /// @param _amounts Array of amounts to sell to each order
    /// @param _token Token address to sell
    /// @param _totalTokens Total amount of tokens to sell
    function marketSell(uint256[] calldata _orderIds, uint256[] calldata _amounts, address _token, uint256 _totalTokens) external nonReentrant {
        if (_orderIds.length != _amounts.length) revert ArrayLengthsMismatch(_orderIds.length, _amounts.length);
        if (_totalTokens == 0) revert InvalidTokenAmount(_totalTokens);

        IERC20(_token).transferFrom(msg.sender, address(this), _totalTokens);

        uint256 remainingAmount = _totalTokens;
        uint256 ordersMatched;

        for (uint256 i = 0; i < _orderIds.length; i++) {
            OrderInfo memory orderInfo = orderInfos[_orderIds[i]];
            if (orderInfo.token == address(0)) {
                continue;
            }

            Order storage order = activeOrdersByToken[_token][orderInfo.index];
            uint256 amountWanted = _amounts[i];

            if (order.orderId != _orderIds[i] ||
                !order.isBuyOrder ||
                order.token != _token ||
                order.amount - order.filled < amountWanted ||
                amountWanted > remainingAmount ||
                amountWanted == 0) {
                continue;
            }

            uint decimals = listedTokens[order.token].decimals;
            uint256 orderCost = order.price * (amountWanted / 10 ** decimals);
            uint256 fee = (orderCost * feePercent) / 10000;
            
            order.filled += amountWanted;
            remainingAmount -= amountWanted;
            collectedFees += fee;
            ordersMatched++;

            IERC20(_token).transfer(order.maker, amountWanted);
            USDT.transfer(msg.sender, orderCost - fee);

            emit OrderFilled(order.orderId, order.maker, msg.sender, _token, order.isBuyOrder, order.price, amountWanted, orderCost, fee, block.timestamp);

            if (order.filled == order.amount) {
                _removeOrder(order.orderId, _token, orderInfo.index);
            }
        }

        if (ordersMatched == 0) revert NoOrdersMatched();

        if (remainingAmount > 0) {
            IERC20(_token).transfer(msg.sender, remainingAmount);
        }
    }

    /// @notice Allows the maker to cancel their order and receive back locked tokens
    /// @dev Validates order ownership and handles refunds based on order type
    /// @param _orderId ID of the order to cancel
    function cancelOrder(uint256 _orderId) external nonReentrant {
        OrderInfo memory orderInfo = orderInfos[_orderId];
        if (orderInfo.token == address(0)) revert OrderNotFound(_orderId);

        Order storage order = activeOrdersByToken[orderInfo.token][orderInfo.index];
        if (order.maker != msg.sender) revert NotOrderMaker(msg.sender, order.maker);

        uint256 remainingAmount = order.amount - order.filled;

        if (order.isBuyOrder) {
            uint256 decimals = listedTokens[orderInfo.token].decimals;
            uint256 refundAmount = order.price * (remainingAmount / (10 ** decimals));
            USDT.transfer(msg.sender, refundAmount);
        } else {
            IERC20(orderInfo.token).transfer(msg.sender, remainingAmount);
        }

        emit OrderCancelled(_orderId, order.maker, orderInfo.token, block.timestamp);
        _removeOrder(_orderId, orderInfo.token, orderInfo.index);
    }

    /// @notice Updates the trading fee percentage
    /// @dev Fee is in basis points (100 = 1%)
    /// @param _feePercent New fee percentage
    function setFeePercent(uint256 _feePercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feePercent > 200) revert FeeSetToHigh(_feePercent);
        feePercent = _feePercent;
    }

    /// @notice Withdraws collected trading fees
    /// @param _to Address to send the withdrawn fees
    /// @param _amount Amount of fees to withdraw
    function withdrawFees(address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_to == address(0)) revert ZeroAddress(_to);
        if (_amount == 0 || _amount > collectedFees) revert InvalidUsdtAmount(_amount);

        collectedFees -= _amount;
        USDT.transfer(_to, _amount);
    }

    /// @notice Returns all active orders for a given token
    /// @param _token Token contract address
    /// @return Array of active orders for the token
    function getActiveOrders(address _token) external view onlyListed(_token) returns (Order[] memory) {
        return activeOrdersByToken[_token];
    }

    /// @notice Internal helper to create and store order details
    /// @dev Updates order ID counter and maintains order location mappings
    /// @param _token Token contract address
    /// @param _isBuyOrder Type of order (true for buy, false for sell)
    /// @param _price Price per token in USDT
    /// @param _amount Amount of tokens in order
    /// @return orderId Unique identifier for the created order
    function _createOrder(address _token, bool _isBuyOrder, uint256 _price, uint256 _amount) private returns (uint256) {
        orderId++;

        activeOrdersByToken[_token].push(Order({
            orderId: orderId,
            maker: msg.sender,
            token: _token,
            isBuyOrder: _isBuyOrder,
            price: _price,
            amount: _amount,
            filled: 0
        }));

        orderInfos[orderId] = OrderInfo({
            token: _token,
            index: activeOrdersByToken[_token].length - 1
        });

        emit OrderCreated(orderId, msg.sender, _token, _isBuyOrder, _price, _amount, block.timestamp);

        return orderId;
    }

    /// @notice Internal helper to remove a completely filled order
    /// @dev Uses swap-and-pop pattern to avoid array shifts and maintains accurate indexes for swapped orders
    /// @param _orderId ID of the order to remove
    /// @param _token Token address of the order
    /// @param _index Index of the order in the activeOrdersByToken array
    function _removeOrder(uint256 _orderId, address _token, uint256 _index) private {
        Order[] storage orders = activeOrdersByToken[_token];

        if (_index != orders.length - 1) {
            orders[_index] = orders[orders.length - 1];
            orderInfos[orders[_index].orderId].index = _index;
        }

        orders.pop();
        delete orderInfos[_orderId];
    }
}
