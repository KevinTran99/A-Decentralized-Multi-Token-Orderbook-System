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

    /// @notice Struct to store order location information
    /// Token address being traded in the order
    /// Index position in the activeOrdersByToken array
    struct OrderLocation {
        address token;
        uint256 index;
    }

    /// @notice Counter for generating unique order IDs
    uint256 public orderId;

    /// @notice Mapping of token address to its listing information
    mapping(address => TokenInfo) public listedTokens;

    /// @notice Mapping of token address to its active orders
    mapping(address => Order[]) public activeOrdersByToken;

    /// @notice Mapping from order ID to its location data for efficient lookups
    mapping(uint256 => OrderLocation) public orderLocations;

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

        orderLocations[orderId] = OrderLocation({
            token: _token,
            index: activeOrdersByToken[_token].length - 1
        });

        emit OrderCreated(orderId, msg.sender, _token, _isBuyOrder, _price, _amount, block.timestamp);

        return orderId;
    }
}
