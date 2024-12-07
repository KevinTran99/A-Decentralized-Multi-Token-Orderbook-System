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
        uint256 amount,
        uint256 filled,
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

    /**
     * @dev Contract constructor
     * @param _usdt Address of the USDT contract
     */
    constructor(address _usdt) {
        require(_usdt != address(0), "Invalid USDT address");
        USDT = IERC20(_usdt);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAIR_LISTER_ROLE, msg.sender);
    }

    /// @notice Lists a new token for trading against USDT
    /// @dev Verifies ERC20 compliance through decimals() call
    /// @param _token Token contract address
    function listToken(address _token) external onlyRole(PAIR_LISTER_ROLE) {
        require(_token != address(0), "Zero address");
        require(!listedTokens[_token].isListed, "Already listed");
        require(_token != address(USDT), "Cannot list USDT");

        uint8 tokenDecimals = IERC20Metadata(_token).decimals();

        listedTokens[_token] = TokenInfo({
            decimals: tokenDecimals,
            isListed: true
        });
        
        emit TokenListed(_token, tokenDecimals, msg.sender);
    }

    /// @notice Creates a buy order for a listed token
    /// @dev Locks USDT payment in contract until order is filled or cancelled
    /// @param _token Token contract address
    /// @param _price Price per token in USDT
    /// @param _amount Amount of tokens to buy
    /// @return orderId Unique identifier for the created order
    function createBuyOrder(address _token, uint256 _price, uint256 _amount) external nonReentrant returns (uint256) {
        require(listedTokens[_token].isListed, "Token not listed");
        require(_price > 0, "Invalid price");
        require(_amount > 0, "Invalid amount");

        uint256 totalCost = _price * _amount;
        require(USDT.transferFrom(msg.sender, address(this), totalCost), "USDT transfer failed");

        return _createOrder(_token, true, _price, _amount);
    }

    /// @notice Creates a sell order for a listed token
    /// @dev Locks tokens in contract until order is filled or cancelled
    /// @param _token Token contract address
    /// @param _price Price per token in USDT
    /// @param _amount Amount of tokens to sell
    /// @return orderId Unique identifier for the created order
    function createSellOrder(address _token, uint256 _price, uint256 _amount) external nonReentrant returns (uint256) {
        require(listedTokens[_token].isListed, "Token not listed");
        require(_price > 0, "Invalid price");
        require(_amount > 0, "Invalid amount");

        require(IERC20(_token).transferFrom(msg.sender, address(this), _amount), "Token transfer failed");

        return _createOrder(_token, false, _price, _amount);
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

    /// @notice Executes market buy orders against existing sell orders
    /// @dev Processes multiple orders in single transaction, skipping invalid ones
    /// @param _orderIds Array of order IDs to buy from
    /// @param _amounts Array of amounts to buy from each order
    /// @param _totalUsdt Total USDT to spend on orders
    function marketBuy(uint256[] calldata _orderIds, uint256[] calldata _amounts, uint256 _totalUsdt) external nonReentrant {
        require(_orderIds.length > 0 && _orderIds.length == _amounts.length, "Invalid input");
        require(_totalUsdt > 0, "Invalid USDT amount");

        require(USDT.transferFrom(msg.sender, address(this), _totalUsdt), "USDT transfer failed");

        uint256 remainingUsdt = _totalUsdt;
        uint256 ordersMatched;
        
        for (uint256 i = 0; i < _orderIds.length; i++) {
            OrderInfo memory orderInfo = orderInfos[_orderIds[i]];
            Order storage order = activeOrdersByToken[orderInfo.token][orderInfo.index];
            uint256 amountWanted = _amounts[i];

            if (order.orderId != _orderIds[i] ||
                order.isBuyOrder ||
                order.token != orderInfo.token ||
                order.amount - order.filled < amountWanted ||
                amountWanted == 0) {
                continue;
            }

            uint256 orderCost = amountWanted * order.price;
            if (orderCost > remainingUsdt) {
                continue;
            }

            order.filled += amountWanted;
            remainingUsdt -= orderCost;
            ordersMatched++;

            require(USDT.transfer(order.maker, orderCost), "USDT transfer failed");
            require(IERC20(order.token).transfer(msg.sender, amountWanted), "Token transfer failed");

            emit OrderFilled(order.orderId, order.maker, msg.sender, order.token, order.isBuyOrder, order.price, order.amount, amountWanted, block.timestamp);

            if (order.filled == order.amount) {
                _removeOrder(_orderIds[i], orderInfo.token, orderInfo.index);
            }
        }

        require(ordersMatched > 0, "No orders matched");

        if (remainingUsdt > 0) {
            require(USDT.transfer(msg.sender, remainingUsdt), "USDT transfer failed");
        }
    }

    /// @notice Executes market sell orders against existing buy orders
    /// @dev Processes multiple orders in single transaction, skipping invalid ones
    /// @param _orderIds Array of order IDs to sell to
    /// @param _amounts Array of amounts to sell to each order
    /// @param _token Token address to sell
    /// @param _totalAmount Total amount of tokens to sell
    function marketSell(uint256[] calldata _orderIds, uint256[] calldata _amounts, address _token, uint256 _totalAmount) external nonReentrant {
        require(_orderIds.length > 0 && _orderIds.length == _amounts.length, "Invalid input");
        require(_totalAmount > 0, "Invalid amount");

        require(IERC20(_token).transferFrom(msg.sender, address(this), _totalAmount), "Token transfer failed");

        uint256 remainingAmount = _totalAmount;
        uint256 ordersMatched;

        for (uint256 i = 0; i < _orderIds.length; i++) {
            OrderInfo memory orderInfo = orderInfos[_orderIds[i]];
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

            order.filled += amountWanted;
            remainingAmount -= amountWanted;
            ordersMatched++;

            require(IERC20(_token).transfer(order.maker, amountWanted), "Token transfer failed");
            uint256 orderCost = amountWanted * order.price;
            require(USDT.transfer(msg.sender, orderCost), "USDT transfer failed");

            emit OrderFilled(order.orderId, order.maker, msg.sender, _token, order.isBuyOrder, order.price, order.amount, amountWanted, block.timestamp);

            if (order.filled == order.amount) {
                _removeOrder(order.orderId, _token, orderInfo.index);
            }
        }

        require(ordersMatched > 0, "No orders matched");

        if (remainingAmount > 0) {
            require(IERC20(_token).transfer(msg.sender, remainingAmount), "Token transfer failed");
        }
    }

    /// @notice Allows the maker to cancel their order and receive back locked tokens
    /// @dev Validates order ownership and handles refunds based on order type
    /// @param _orderId ID of the order to cancel
    function cancelOrder(uint256 _orderId) external nonReentrant {
        OrderInfo memory orderInfo = orderInfos[_orderId];
        require(orderInfo.token != address(0), "Order not found");

        Order storage order = activeOrdersByToken[orderInfo.token][orderInfo.index];
        require(order.maker == msg.sender, "Not order maker");

        uint256 remainingAmount = order.amount - order.filled;

        if (order.isBuyOrder) {
            uint256 refundAmount = remainingAmount * order.price;
            require(USDT.transfer(msg.sender, refundAmount), "USDT transfer failed");
        } else {
            require(IERC20(orderInfo.token).transfer(msg.sender, remainingAmount), "Token transfer failed");
        }

        emit OrderCancelled(_orderId, order.maker, orderInfo.token, block.timestamp);
        _removeOrder(_orderId, orderInfo.token, orderInfo.index);
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
